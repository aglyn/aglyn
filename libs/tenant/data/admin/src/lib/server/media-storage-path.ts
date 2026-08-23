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
 * `storagePath` is CLIENT DATA, and it addresses the shared bucket (AGL-1881).
 *
 * ## The hole this closes
 *
 * A media document records the object key its bytes live at, and seven code
 * paths read that field and hand it straight to `bucket.file(...)` on the
 * ADMIN SDK — which bypasses `cloud/firebase-storage.rules` entirely, because
 * Admin credentials are not subject to them. The field was writable by any org
 * editor or host editor:
 *
 * - `orgs/{orgId}/media/{id}` — the dedicated rule freezes only `visibleTo`.
 * - `hosts/{hostId}/media/{id}` — `media` appears in NEITHER the create nor the
 *   update exclusion list of the host catch-all, so `canWriteHostContent` is
 *   the whole gate.
 *
 * So a legitimate editor could point their own media document at any object
 * key in the bucket and then reach it through the paths that trust the field:
 * `serveMediaCdn` streams it to an anonymous caller behind an edge-cached URL,
 * `/api/media/replace` overwrites it, and the folder delete removes it. Read,
 * overwrite and destroy, all cross-tenant, all from a document the attacker is
 * supposed to own.
 *
 * The bucket is shared and holds more than customer media: `orgs/{orgId}/`,
 * the legacy `hosts/{hostId}/media/`, `users/{uid}/` avatars, and — the part
 * that makes this worse than "read another tenant's images" — the
 * `adminAudit-archive/` and `erasures/` retention prefixes, which are FIXED and
 * guessable rather than needing a stolen object key.
 *
 * ## Why the fix lives here and not only in the rules
 *
 * Freezing the field in the rules is right and is being done alongside this,
 * but it is the second layer, not the first. Rules are deployed separately
 * from code, staff writes bypass them, and a future writer could reintroduce
 * the field legitimately. The durable invariant is at the SINK: an object key
 * derived from a document must address that document's own scope, and that is
 * checkable without trusting anything.
 *
 * ## The invariant
 *
 * Every writer in the repo — `media/upload`, `media/upload-url`, the v1 media
 * create, and the folder relocation — builds the key as
 * `` `${base}/media/` + optional folder path + mediaId ``, where `base` is
 * `orgs/{orgId}` or `hosts/{hostId}`. There is no legitimate key outside
 * `${base}/media/`, so that is the prefix required here rather than the looser
 * `${base}/`.
 */

/**
 * True when `candidate` is an object key that genuinely lives under this
 * scope's media prefix.
 *
 * Traversal is rejected rather than normalized. GCS object keys are literal
 * strings — `a/../b` is a key containing dots, not a path that resolves — so
 * `..` cannot escape a prefix in the bucket itself. It is refused anyway
 * because these keys are also handed to `File.copy`, tooling and log lines
 * that may not share that property, and because a `..` in a key this repo
 * writes is by construction not one this repo wrote.
 */
export function isMediaStoragePathInScope(
  candidate: unknown,
  base: string,
): boolean {
  if (typeof candidate !== 'string') return false
  const value = candidate.trim()
  if (!value || value !== candidate) return false
  if (!base) return false
  const prefix = `${base}/media/`
  if (!value.startsWith(prefix)) return false
  // Something has to follow the prefix; the prefix alone is a folder.
  if (value.length === prefix.length) return false
  if (value.includes('//')) return false
  return !value.split('/').includes('..')
}

/**
 * The object key for a media document: the recorded `storagePath` when it is
 * genuinely in scope, otherwise the legacy flat layout.
 *
 * Falling back rather than throwing is deliberate. The fallback names the
 * document's OWN object, so a tampered record addresses nothing but itself —
 * a read 404s, a delete removes a key that does not exist, and a replace
 * writes where the asset should have been. Throwing would turn a tampered
 * document into a 500 on a route that other, innocent assets share, which
 * trades a contained failure for a noisy one.
 *
 * `onRefused` exists because a refusal here is not a normal condition: every
 * writer in the repo produces an in-scope key, so a refused one means the
 * document was written by something else. Callers that can log should.
 */
export function mediaStoragePathInScope(options: {
  storagePath: unknown
  base: string
  mediaId: string
  onRefused?: (candidate: unknown) => void
}): string {
  const { storagePath, base, mediaId } = options
  const fallback = `${base}/media/${mediaId}`
  if (storagePath === undefined || storagePath === null || storagePath === '') {
    // The ordinary legacy case — the field predates real folders. Not a
    // refusal, and must not be reported as one.
    return fallback
  }
  if (isMediaStoragePathInScope(storagePath, base)) return storagePath as string
  options.onRefused?.(storagePath)
  return fallback
}
