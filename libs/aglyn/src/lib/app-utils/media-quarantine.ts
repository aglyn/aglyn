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
 * ASSET QUARANTINE (AGL-1512) — the proportionate lever beside the AGL-1501
 * panic button.
 *
 * When the infection is ONE uploaded file (malware in a PDF, an abusive
 * image, a DMCA-noticed asset), locking the whole host punishes a customer
 * for one object. Quarantine refuses that object at the CDN while the site
 * keeps running — and, unlike deletion, it is REVERSIBLE, which is what a
 * false-positive scan or a successful DMCA counter-notice needs.
 *
 * ## Three design calls, argued
 *
 * **Keyed by `contentHash`, not by media document.** By hash covers every
 * document that shares the bytes — a template duplicated into forty
 * workspaces is forty documents and one hash — and it survives a re-upload
 * of the same file, which a per-document key does not. The limits of that
 * promise are stated honestly at {@link mediaQuarantineHashKey}; it is not
 * a content-identity guarantee, and pretending otherwise would be worse
 * than the gap.
 *
 * **A per-asset key exists as a FALLBACK, not an alternative.** Some
 * documents carry no `contentHash` at all: the signed-upload route only
 * learns one from GCS's `md5Hash` (absent on composite objects), and every
 * asset uploaded before that route computed one has none. A takedown lever
 * that silently cannot touch the largest files is not a takedown lever, so
 * {@link mediaQuarantineKey} falls back to `asset--{scope}--{mediaId}` — and
 * only there, so the hash key stays the norm.
 *
 * **ONE deny-list document, not one document per quarantine.** The consult
 * sits on the hottest unauthenticated path in the product: every image, in
 * every grid, on every published page. A document per quarantined hash would
 * be one Firestore read per DISTINCT ASSET per TTL — a fifty-tile DAM grid
 * would go from one lock read to fifty-one. The whole deny list is instead
 * one document (`mediaQuarantines/index`), so the entire feature costs ONE
 * read per process per TTL no matter how many assets are requested or how
 * many are quarantined. This is the tombstone/deny-list pattern the issue
 * names, and it is the same read-cost discipline as AGL-1302.
 *
 * ## What quarantine deliberately does NOT do
 *
 * It does not delete the object, does not touch the media document, and
 * **does not change `sizeBytes` or the `counters/media` accounting**. The
 * storage counter is a billing input: the file still exists and still
 * belongs to the org. It is SUPPRESSED, not erased, and a lever that
 * silently re-bills a customer while refusing their file would be a
 * different bug than the one it fixed.
 *
 * The state lives in `mediaQuarantines/index`, which has **no Firestore
 * rules block on purpose**. The collection is Admin-SDK-only — written by
 * `/api/admin/media-quarantine`, read by `serveMediaCdn` — so the default
 * deny is already the exactly-correct posture, and it needs no rules
 * deploy to be safe. A staff READ block becomes necessary only if a
 * client-side surface ever reads it directly; the staff surfaces here read
 * through the API route instead.
 */

import { isLockdownActive } from './lockdown'

/**
 * Why a file was disabled. Deliberately NOT `LockdownReasonCode`: the
 * lockdown vocabulary (security / billing / maintenance / manual) cannot
 * say "DMCA", and a takedown recorded as "security" is a record that
 * cannot answer the only question anyone asks about it a year later.
 *
 * The field FAMILY around it is AGL-1501's, unchanged — `reason`,
 * `message`, `atMs`, `untilMs`, `actorUid` — so an operator reading an
 * audit row is reading the same shape either way.
 */
export type MediaQuarantineReason =
  | 'malware'
  | 'abuse'
  | 'dmca'
  | 'legal'
  | 'manual'

const MEDIA_QUARANTINE_REASON_KEYS: Record<MediaQuarantineReason, true> = {
  malware: true,
  abuse: true,
  dmca: true,
  legal: true,
  manual: true,
}

export const MEDIA_QUARANTINE_REASONS = Object.keys(
  MEDIA_QUARANTINE_REASON_KEYS,
) as MediaQuarantineReason[]

export function isMediaQuarantineReason(
  value: unknown,
): value is MediaQuarantineReason {
  return typeof value === 'string' && value in MEDIA_QUARANTINE_REASON_KEYS
}

/** Staff-surface labels; the key stays the wire/API identity. */
export const MEDIA_QUARANTINE_REASON_LABELS: Record<
  MediaQuarantineReason,
  string
> = {
  malware: 'Malware or malicious content',
  abuse: 'Abuse report',
  dmca: 'DMCA takedown notice',
  legal: 'Other legal demand',
  manual: 'Staff decision (other)',
}

export const MEDIA_QUARANTINES_COLLECTION = 'mediaQuarantines'

/**
 * The single deny-list document. One document, one read, whole feature —
 * see the read-cost argument in the module header.
 */
export const MEDIA_QUARANTINE_INDEX_DOC_ID = 'index'

/** The map field inside that document: quarantine key → entry. */
export const MEDIA_QUARANTINE_ENTRIES_FIELD = 'entries'

/**
 * How many entries one index document may hold.
 *
 * A Firestore document caps at 1 MiB and an entry is a few hundred bytes,
 * so the real ceiling is thousands — this cap is far below it on purpose.
 * The write path REFUSES past it rather than growing a document that would
 * one day fail to write, because the failure mode of an over-full deny list
 * is "a takedown silently did not land", which is the exact thing this
 * mechanism exists to prevent. Sharding is a filed follow-up, not a
 * surprise.
 */
export const MEDIA_QUARANTINE_MAX_ENTRIES = 2000

/** Staff-typed notice text is owner-facing; keep it bounded and plain. */
export const MEDIA_QUARANTINE_MESSAGE_MAX = 500

/** Internal staff rationale — never shown to the customer. */
export const MEDIA_QUARANTINE_NOTE_MAX = 1000

/**
 * A quarantine key derived from a content hash.
 *
 * **What this promises, and what it does not.** `contentHash` is a 16-hex
 * character (64-bit) TRUNCATED digest, and it is produced by two different
 * algorithms depending on which route ingested the bytes: sha256 for the
 * server-side upload and replace routes, GCS's md5 for the signed-upload
 * route. Two consequences, both stated rather than hidden:
 *
 *  1. The same bytes uploaded through DIFFERENT routes do not share a
 *     `contentHash`, so "re-uploading the same file stays quarantined"
 *     holds within an ingestion path, not across all of them.
 *  2. 64 truncated bits is collision-resistant by accident, not by design.
 *     An unrelated asset colliding by chance is negligible at this scale;
 *     an asset colliding by CONSTRUCTION is within reach, and would refuse
 *     an innocent file. That is an availability bug, never a disclosure
 *     one — a collision can only ever cause MORE refusal, never less.
 *
 * Both are properties of the existing `contentHash` field rather than of
 * this key, and both are filed. The key is normalized to lower case so a
 * hand-entered hash from a staff form cannot miss its own record.
 */
export function mediaQuarantineHashKey(contentHash: string): string {
  return `hash--${String(contentHash).trim().toLowerCase()}`
}

/**
 * The per-asset fallback key, for documents that carry no `contentHash`.
 * Scope-qualified because a media id is only unique within its own
 * `orgs/{id}` or `hosts/{id}` library.
 */
export function mediaQuarantineAssetKey(
  scopeSegment: string,
  mediaId: string,
): string {
  return `asset--${scopeSegment}--${mediaId}`
}

/**
 * THE key for one asset: its content hash when it has one, its identity
 * when it does not. `null` is impossible in practice (a media id always
 * exists) and returned anyway rather than emitting a key like
 * `asset----`, which would be a deny-list entry matching nothing and
 * looking like it matched everything.
 */
export function mediaQuarantineKey(asset: {
  contentHash?: string | null
  scopeSegment?: string | null
  mediaId?: string | null
}): string | null {
  const hash = String(asset.contentHash ?? '').trim()
  if (hash) return mediaQuarantineHashKey(hash)
  const scopeSegment = String(asset.scopeSegment ?? '').trim()
  const mediaId = String(asset.mediaId ?? '').trim()
  if (!scopeSegment || !mediaId) return null
  return mediaQuarantineAssetKey(scopeSegment, mediaId)
}

/**
 * One entry as stored in the index document's `entries` map.
 *
 * Every optional field is written as an explicit `null` rather than left
 * off (the repo's standing Firestore rule — a converter or a partial write
 * must never carry `undefined`), so a reader can distinguish "no expiry"
 * from "this record predates expiry".
 */
export interface MediaQuarantineEntry {
  reason: MediaQuarantineReason
  /** Owner-facing notice text; `null` uses the per-reason default copy. */
  message?: string | null
  /** Staff-only rationale. NEVER rendered to the customer. */
  note?: string | null
  atMs?: number | null
  /** Optional expiry — passing it restores delivery with no write. */
  untilMs?: number | null
  actorUid?: string | null
  /**
   * Where the quarantine was set FROM, for the audit trail only. A hash
   * key can cover documents in many orgs; this records the one an operator
   * was looking at, and is never used to decide whether to refuse.
   */
  originScopeSegment?: string | null
  originMediaId?: string | null
}

/** The normalized, in-memory shape every consumer reads. */
export interface MediaQuarantineState {
  key: string
  reason: MediaQuarantineReason
  message?: string
  atMs?: number
  untilMs?: number
  actorUid?: string
}

/**
 * Entry → state. A malformed entry (no recognised reason) is refused
 * WHOLE rather than defaulted, matching `normalizeLockdownDoc`: the
 * takedown path does not guess, and a record nobody can explain is not a
 * record anyone should enforce.
 *
 * `note` is deliberately not carried into the state — the staff rationale
 * must not be able to reach a surface that renders `message`.
 */
export function normalizeMediaQuarantine(
  entry: Partial<MediaQuarantineEntry> | null | undefined,
  key: string,
): MediaQuarantineState | null {
  if (!entry) return null
  if (!isMediaQuarantineReason(entry.reason)) return null
  return {
    key,
    reason: entry.reason,
    message:
      typeof entry.message === 'string' && entry.message
        ? entry.message.slice(0, MEDIA_QUARANTINE_MESSAGE_MAX)
        : undefined,
    atMs: typeof entry.atMs === 'number' ? entry.atMs : undefined,
    untilMs:
      typeof entry.untilMs === 'number' && Number.isFinite(entry.untilMs)
        ? entry.untilMs
        : undefined,
    actorUid: typeof entry.actorUid === 'string' ? entry.actorUid : undefined,
  }
}

/**
 * Active now? Expiry passing deactivates with no write — the same
 * semantics as `isLockdownActive`, which this calls rather than restates
 * so the two levers can never drift on what "expired" means.
 */
export function isMediaQuarantineActive(
  state: MediaQuarantineState | null | undefined,
  nowMs: number,
): boolean {
  return state != null && isLockdownActive(state, nowMs)
}

export interface MediaQuarantineNotice {
  title: string
  body: string
  contact?: string
}

export const MEDIA_QUARANTINE_SUPPORT_EMAIL = 'support@aglyn.com'

/**
 * The OWNER-facing notice: "this file was disabled: {reason} — contact
 * support". Shown in the console to the org that owns the asset, never on
 * the CDN response (which stays a neutral 410 — see the refusal argument
 * in `serve-media-cdn.ts`).
 *
 * A staff-typed `message` replaces the body; the title and the contact
 * line stay per-reason so an operator cannot accidentally strip the "how
 * do I get this back" affordance. Every body says the file still EXISTS —
 * a customer whose asset is refused must not conclude their data was
 * deleted, because for every reason here it was not.
 */
export function mediaQuarantineNotice(
  state: Pick<MediaQuarantineState, 'reason' | 'message'>,
): MediaQuarantineNotice {
  const custom =
    typeof state.message === 'string' && state.message.trim()
      ? state.message.trim()
      : undefined
  const contact = MEDIA_QUARANTINE_SUPPORT_EMAIL
  switch (state.reason) {
    case 'malware':
      return {
        title: 'This file was disabled',
        body:
          custom ??
          'This file was disabled after it was flagged as malicious. It ' +
            'has not been deleted and still counts toward your storage. ' +
            'If you believe this is a mistake, contact support.',
        contact,
      }
    case 'abuse':
      return {
        title: 'This file was disabled',
        body:
          custom ??
          'This file was disabled following an abuse report. It has not ' +
            'been deleted and still counts toward your storage. Contact ' +
            'support to discuss it.',
        contact,
      }
    case 'dmca':
      return {
        title: 'This file was disabled',
        body:
          custom ??
          'This file was disabled in response to a copyright takedown ' +
            'notice. It has not been deleted and still counts toward your ' +
            'storage. Contact support if you want to file a counter-notice.',
        contact,
      }
    case 'legal':
      return {
        title: 'This file was disabled',
        body:
          custom ??
          'This file was disabled in response to a legal demand. It has ' +
            'not been deleted and still counts toward your storage. ' +
            'Contact support for details.',
        contact,
      }
    case 'manual':
    default:
      return {
        title: 'This file was disabled',
        body:
          custom ??
          'This file was disabled by Aglyn staff. It has not been deleted ' +
            'and still counts toward your storage. Contact support to find ' +
            'out why.',
        contact,
      }
  }
}
