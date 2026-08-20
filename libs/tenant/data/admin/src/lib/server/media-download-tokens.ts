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

/**
 * Raw-download-URL revocation for a security lockdown (AGL-1526).
 *
 * THE HOLE THIS CLOSES. AGL-1520 put a lockdown gate on the media CDN
 * (`mediaCdnServeBlock`), and that gate works because the CDN path runs OUR
 * code: a locked scope gets a 410. But a media object can also be addressed
 * directly at Google's edge:
 *
 *     https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}
 *       ?alt=media&token={firebaseStorageDownloadTokens}
 *
 * That URL is the free-tier / legacy delivery path — every upload route
 * still mints one and stores it on the media doc's `url`. **No code of ours
 * runs on that origin.** A lock cannot refuse it, a revalidation cannot
 * evict it, and the tenant middleware never sees it. It serves the locked
 * org's bytes to anyone holding the link until the token dies.
 *
 * The only thing that kills it is the token itself, which lives in the
 * object's custom metadata. Rewrite that entry and Google's edge starts
 * answering the old URL with 403 — immediately, with no cache of ours in
 * the path and nothing to revalidate.
 *
 * KNOWN CONSEQUENCE, not a bug: the media doc's own `url` field still holds
 * the OLD raw URL after rotation, so it is stale-by-design for the duration
 * of the lock — which is the intent — and stays stale after an unlock. The
 * console DAM and the public `GET /api/v1/media` both fall back to `url`
 * when an asset has no `cdnPath` (free tier, private assets, pre-AGL-829
 * uploads), so those surfaces will show broken images for a rotated org
 * once it is unlocked. Rewriting every media doc's `url` is a second,
 * Firestore-wide pass that deliberately is NOT done here: during the lock
 * the dead link is the point, and a repair pass that ran at lock time would
 * be handing back a working URL. See the AGL-1526 thread.
 *
 * WHAT THIS DOES NOT DO (AGL-1615, honestly). Rotation kills the URL, not
 * the bytes. Anything that already fetched them — a browser cache, a
 * downstream CDN, a scraper's disk, an archive.org snapshot — keeps what it
 * has. Like quarantine and like the CDN gate, this stops only NEW origin
 * fetches. It is the strongest control available on a path we do not serve,
 * and it is not a recall.
 *
 * THREE DELIBERATE NARROWINGS:
 *
 *  1. **`security` reason only, `full` mode only.** Rotation is
 *     IRREVERSIBLE for embeds: the new token is a new URL, so every raw URL
 *     already pasted into a screen, an email or a customer's site stays
 *     dead after the lock is lifted. The stable CDN URL (AGL-829) survives
 *     and is the supported reference, but pre-AGL-829 content that still
 *     embeds raw URLs will visibly break. That price is worth paying to cut
 *     off an org serving malware or CSAM; it is NOT worth paying because an
 *     invoice failed. `billing` and `maintenance` therefore never rotate,
 *     and neither does a read-only lock — a read-only lock's whole promise
 *     is that the sites keep serving.
 *
 *  2. **Only objects that ALREADY carry a token are touched.** An object
 *     with no `firebaseStorageDownloadTokens` entry has no raw URL to kill,
 *     so rotating it would be pure cost — and worse, WRITING a token where
 *     none existed would MINT a public raw URL for an object that never had
 *     one. The scan skips them. This is why the result reports `scanned`
 *     and `rotated` separately.
 *
 *  3. **Bounded, and awaited anyway.** AGL-1526 suggested firing this off
 *     async so the lock write does not wait on it. It is awaited instead,
 *     under an object cap and a wall-clock budget, because an unawaited
 *     promise in a serverless invocation is frozen the moment the response
 *     is returned — the classic shape of a control that exists and never
 *     runs. A bounded rotation that provably ran beats an unbounded one
 *     that provably did not; when a bound is hit the result says
 *     `truncated` so the audit row records an incomplete revocation rather
 *     than implying a clean one.
 */

import { randomUUID } from 'node:crypto'
import { firebaseAdmin } from './firebase-admin'

/** The custom-metadata key Firebase reads the raw download token from. */
export const DOWNLOAD_TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens'

/**
 * Per-prefix object cap. Well past any real library; a scope somehow larger
 * rotates this many and reports `truncated` rather than running unbounded
 * inside a request.
 */
export const MAX_ROTATED_OBJECTS = 5000
/** Wall-clock budget per prefix, comfortably inside the route's own limit. */
export const ROTATION_BUDGET_MS = 20_000
/** Objects listed per Storage page. */
const PAGE_SIZE = 500
/** In-flight `setMetadata` calls; the bucket is the bottleneck, not us. */
const ROTATE_CONCURRENCY = 8

export interface DownloadTokenRotationResult {
  /** Storage prefix scanned, e.g. `orgs/acme/`. */
  prefix: string
  /** Objects listed under the prefix. */
  scanned: number
  /** Objects that carried a token and got a new one. */
  rotated: number
  /** Objects that carried a token and whose rewrite failed. */
  failed: number
  /** Whether a bound stopped the scan before the prefix was exhausted. */
  truncated: boolean
  ok: boolean
  reason: string
}

/**
 * The admin app is initialized without a default storageBucket, so every
 * bucket access must name it explicitly (same as `erase.ts` and the media
 * routes).
 */
function storageBucket(): any {
  const name = process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET']
  return firebaseAdmin.app().storage().bucket(name || undefined)
}

/**
 * Does this lock revoke raw download URLs?
 *
 * Deliberately a pure predicate over the lock's own two fields, exported so
 * the lockdown core and its specs test the SAME rule rather than two copies
 * that can drift. See narrowing (1) above for why the answer is this narrow.
 */
export function lockRotatesDownloadTokens(lock: {
  reason?: string
  mode?: 'full' | 'read-only'
}): boolean {
  if (!lock) return false
  if (lock.mode === 'read-only') return false
  return lock.reason === 'security'
}

/**
 * Rewrite the download token on every already-tokened object under one
 * Storage prefix.
 *
 * Fail-soft per object: one 403 on one file must not abandon the rest of a
 * security revocation. Failures are counted and reported, never thrown —
 * the caller (a lock that has already been applied) has nothing useful to
 * do with an exception, but the audit row wants the number.
 */
export async function rotateDownloadTokensUnderPrefix(options: {
  prefix: string
  /** Injectable for tests; defaults to the configured media bucket. */
  bucket?: any
  maxObjects?: number
  budgetMs?: number
  now?: () => number
}): Promise<DownloadTokenRotationResult> {
  const { prefix } = options
  const maxObjects = options.maxObjects ?? MAX_ROTATED_OBJECTS
  const budgetMs = options.budgetMs ?? ROTATION_BUDGET_MS
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const result: DownloadTokenRotationResult = {
    prefix,
    scanned: 0,
    rotated: 0,
    failed: 0,
    truncated: false,
    ok: true,
    reason: 'ok',
  }
  if (!prefix) return { ...result, ok: false, reason: 'no-prefix' }

  let bucket: any
  try {
    bucket = options.bucket ?? storageBucket()
  } catch (error) {
    console.error('[lockdown] storage bucket unavailable', prefix, error)
    return { ...result, ok: false, reason: 'not-configured' }
  }
  if (!bucket) return { ...result, ok: false, reason: 'not-configured' }

  let pageToken: string | undefined
  try {
    do {
      const [files, nextQuery] = await bucket.getFiles({
        prefix,
        maxResults: PAGE_SIZE,
        autoPaginate: false,
        ...(pageToken ? { pageToken } : {}),
      })
      const batch: any[] = Array.isArray(files) ? files : []
      result.scanned += batch.length

      for (let index = 0; index < batch.length; index += ROTATE_CONCURRENCY) {
        await Promise.all(
          batch
            .slice(index, index + ROTATE_CONCURRENCY)
            .map((file: any) => rotateOne(file, result)),
        )
      }

      pageToken = nextQuery?.pageToken
      if (result.scanned >= maxObjects && pageToken) {
        result.truncated = true
        result.reason = 'object-cap'
        break
      }
      if (now() - startedAt >= budgetMs && pageToken) {
        result.truncated = true
        result.reason = 'time-budget'
        break
      }
    } while (pageToken)
  } catch (error) {
    console.error('[lockdown] download-token rotation failed', prefix, error)
    return { ...result, ok: false, reason: 'error' }
  }

  return result
}

/**
 * One object's rewrite.
 *
 * The existing custom-metadata map is READ AND RESPREAD rather than
 * replaced with a lone token key, because `setMetadata` overwrites the
 * whole custom map (the same trap `POST /api/media/folders` documents at
 * its move path). Dropping the map here would silently erase every
 * customer-set metadata pair on a locked org's library — a lock is not a
 * data-loss event.
 */
async function rotateOne(
  file: any,
  result: DownloadTokenRotationResult,
): Promise<void> {
  const existing = (file?.metadata?.metadata ?? {}) as Record<string, unknown>
  // Narrowing (2): no token, no raw URL, nothing to revoke — and minting
  // one here would CREATE the exposure this function exists to remove.
  if (!existing[DOWNLOAD_TOKEN_METADATA_KEY]) return
  try {
    await file.setMetadata({
      metadata: { ...existing, [DOWNLOAD_TOKEN_METADATA_KEY]: randomUUID() },
    })
    result.rotated += 1
  } catch (error) {
    console.error('[lockdown] token rewrite failed', file?.name, error)
    result.failed += 1
  }
}

/**
 * Rotate across every prefix a lock scope owns.
 *
 * An ORG lock passes `orgs/{orgId}/` AND `hosts/{hostId}/` for each of its
 * sites: org-scope and host-scope libraries are separate Storage trees
 * (`MediaScope.base`), and a lock that cleaned only the org tree would
 * leave every site's own assets serving — which is most of them.
 */
export async function rotateScopeDownloadTokens(options: {
  prefixes: readonly string[]
  bucket?: any
  maxObjects?: number
  budgetMs?: number
  now?: () => number
}): Promise<DownloadTokenRotationResult[]> {
  const results: DownloadTokenRotationResult[] = []
  for (const prefix of options.prefixes ?? []) {
    results.push(
      await rotateDownloadTokensUnderPrefix({
        prefix,
        bucket: options.bucket,
        maxObjects: options.maxObjects,
        budgetMs: options.budgetMs,
        now: options.now,
      }),
    )
  }
  return results
}
