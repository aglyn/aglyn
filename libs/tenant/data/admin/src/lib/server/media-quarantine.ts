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
 * Server half of asset quarantine (AGL-1512): the deny-list read that
 * `serveMediaCdn` consults before any byte leaves Storage. The pure shape,
 * key derivation and owner copy live in `@aglyn/aglyn`
 * `app-utils/media-quarantine.ts`; this module adds the Admin-SDK read and
 * the two properties only the server can hold.
 *
 * **One read for the whole feature.** The entire deny list is a single
 * document, TTL-cached in-process, so a request for any asset — one, or the
 * fifty tiles of a DAM grid, or every image on a published page — costs at
 * most ONE Firestore read per process per {@link MEDIA_QUARANTINE_TTL_MS}.
 * The alternative (a document per quarantined hash) would have made the
 * cost scale with distinct assets requested, on the hottest unauthenticated
 * path in the product. Same discipline as AGL-1302, same TTL as the
 * lockdown verdict so both levers converge on the same clock.
 *
 * **Fail OPEN on infrastructure error**, matching the lockdown core: an
 * unreachable Firestore is an outage, not a takedown, and a Firestore blip
 * must not blank every customer image on every site. The residual risk is
 * stated rather than traded away — during a Firestore outage a quarantined
 * asset can serve. That is the same posture the platform already takes for
 * a platform-wide security lockdown, and inverting it here would mean a
 * database outage becomes a total media outage.
 */

import {
  isMediaQuarantineActive,
  MEDIA_QUARANTINE_ENTRIES_FIELD,
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINES_COLLECTION,
  type MediaQuarantineEntry,
  type MediaQuarantineState,
  mediaQuarantineKeys,
  normalizeMediaQuarantine,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'

/**
 * Deny-list TTL. Deliberately the lockdown verdict's 15s: this is a
 * takedown path, and 15s is the worst-case lag between staff pressing the
 * button and a warm process refusing its next request for the asset. It is
 * also the lag on a LIFT, which matters just as much — reversibility is the
 * entire reason quarantine exists instead of deletion.
 */
export const MEDIA_QUARANTINE_TTL_MS = 15_000

type QuarantineIndex = Record<string, Partial<MediaQuarantineEntry>>

let indexCache: { at: number; entries: QuarantineIndex } | undefined
let indexPending: Promise<QuarantineIndex> | undefined

/**
 * Drop the in-process deny list. The admin route calls it after a write so
 * the process that took the action enforces immediately; every other
 * process converges within the TTL. Tests need it between cases.
 *
 * Note what this canNOT do in production: the quarantine is written by the
 * console app and enforced by the tenant app, different processes an
 * in-process invalidation can never reach. The TTL is the real mechanism.
 */
export function invalidateMediaQuarantineCache(): void {
  indexCache = undefined
  indexPending = undefined
}

/** The whole deny list, TTL-cached. `{}` on any error (fail open). */
async function readQuarantineIndex(): Promise<QuarantineIndex> {
  if (indexCache && Date.now() - indexCache.at < MEDIA_QUARANTINE_TTL_MS) {
    return indexCache.entries
  }
  if (!indexPending) {
    indexPending = (async () => {
      let entries: QuarantineIndex = {}
      try {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection(MEDIA_QUARANTINES_COLLECTION)
          .doc(MEDIA_QUARANTINE_INDEX_DOC_ID)
          .get()
        const raw = snapshot.get(MEDIA_QUARANTINE_ENTRIES_FIELD)
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          entries = raw as QuarantineIndex
        }
      } catch {
        // Fail open — see the module header. An outage is not a takedown.
      }
      indexCache = { at: Date.now(), entries }
      return entries
    })().finally(() => {
      indexPending = undefined
    })
  }
  return indexPending
}

/**
 * Is this asset quarantined right now? Returns the state so a caller that
 * wants to explain itself can (the console does); the CDN deliberately
 * only uses the boolean, because its refusal must stay neutral.
 *
 * EVERY key is checked, and any one refusing is enough — see
 * {@link mediaQuarantineKeys} for why none of them may be dropped. In
 * short: the strong AGL-1614 `contentSha256`, the legacy truncated
 * `contentHash`, and the per-asset fallback are all keys a quarantine in
 * force may have been written under, and a takedown that stops biting
 * because the document gained a better field would be the worst outcome
 * this lever can produce. Checking all of them costs nothing: the deny list
 * is already in memory.
 */
export async function getMediaQuarantine(asset: {
  contentSha256?: string | null
  contentHash?: string | null
  scopeSegment?: string | null
  mediaId?: string | null
}): Promise<MediaQuarantineState | null> {
  const keys = mediaQuarantineKeys(asset)
  if (!keys.length) return null
  const entries = await readQuarantineIndex()
  const nowMs = Date.now()
  for (const key of keys) {
    const state = normalizeMediaQuarantine(entries[key], key)
    if (isMediaQuarantineActive(state, nowMs)) return state
  }
  return null
}
