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
 * ASSET QUARANTINE (AGL-1512) — the narrow lever beside AGL-1501's panic
 * button, and the ONLY writer of `mediaQuarantines/index`.
 *
 * The collection has no Firestore rules block, deliberately: it is
 * Admin-SDK-only, so the default deny is already exactly right and this
 * feature adds NO rules-deploy debt. A staff read block would only become
 * necessary if a client-side surface ever read the deny list directly, and
 * the staff surfaces read it through this route instead.
 *
 * Same posture as `/api/admin/lockdown`, for the same reasons:
 *
 * - **Super staff role only** to write. A takedown is not a flag: it stops
 *   a customer's file from serving worldwide. Fails CLOSED to the
 *   least-privileged role on a missing claim (AGL-495).
 * - **Every action — set AND lift — writes an `adminAudit` row**, with the
 *   reason, the actor, the expiry and the message the customer was shown.
 *   A lift row that could not say what it released would make a forgotten
 *   quarantine indistinguishable from a procedural one.
 * - **Every write answers with a fresh READ of what it wrote** (AGL-1571).
 *   A click is a request, and a request that never left the pointer looks
 *   exactly like one that succeeded.
 *
 * What this route must never do, and does not: touch the media document,
 * the object in Storage, or `counters/media`. The storage counter is a
 * BILLING input — the file still exists and still belongs to the org. It is
 * suppressed, not erased, and quietly re-billing a customer while refusing
 * their file would be a worse bug than the one quarantine fixes. The only
 * two collections this route writes are `mediaQuarantines` and
 * `adminAudit`.
 */

import {
  isMediaQuarantineReason,
  MEDIA_QUARANTINE_ENTRIES_FIELD,
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINE_MAX_ENTRIES,
  MEDIA_QUARANTINE_MESSAGE_MAX,
  MEDIA_QUARANTINE_NOTE_MAX,
  MEDIA_QUARANTINE_REASONS,
  MEDIA_QUARANTINES_COLLECTION,
  type MediaQuarantineEntry,
  mediaQuarantineAssetKey,
  mediaQuarantineHashKey,
  mediaQuarantineNotice,
  normalizeMediaQuarantine,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  invalidateMediaQuarantineCache,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/**
 * What may appear in a CDN scope segment (`{hostId}`, `org:{orgId}`,
 * `org:{orgId}:{hostId}`) — mirrored from `parseMediaCdnScope`'s alphabet
 * plus the `:` that joins its parts.
 *
 * Validated HERE rather than trusted because these strings become map KEYS
 * inside a Firestore document. A `.` would be read as a field-path
 * separator by any later code that addresses the entry by path, and a key
 * that cannot be addressed is a quarantine that cannot be lifted — the one
 * failure this lever must never have.
 */
const SCOPE_SEGMENT = /^[A-Za-z0-9_:-]{1,140}$/
const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/
/** `contentHash` is a 16-char truncated hex digest (see media-quarantine.ts). */
const CONTENT_HASH = /^[A-Fa-f0-9]{8,64}$/

/** The audit row's view of a quarantine — explicit `null`, never absent. */
function auditEntryShape(entry: Partial<MediaQuarantineEntry> | null): {
  reason: string | null
  message: string | null
  note: string | null
  untilMs: number | null
  atMs: number | null
  actorUid: string | null
} {
  return {
    reason: typeof entry?.reason === 'string' ? entry.reason : null,
    message: typeof entry?.message === 'string' ? entry.message : null,
    note: typeof entry?.note === 'string' ? entry.note : null,
    untilMs: typeof entry?.untilMs === 'number' ? entry.untilMs : null,
    atMs: typeof entry?.atMs === 'number' ? entry.atMs : null,
    actorUid: typeof entry?.actorUid === 'string' ? entry.actorUid : null,
  }
}

type AdminFirestore = ReturnType<
  ReturnType<typeof firebaseAdmin.app>['firestore']
>

const indexRef = (firestore: AdminFirestore) =>
  firestore
    .collection(MEDIA_QUARANTINES_COLLECTION)
    .doc(MEDIA_QUARANTINE_INDEX_DOC_ID)

async function readEntries(
  firestore: AdminFirestore,
): Promise<Record<string, Partial<MediaQuarantineEntry>>> {
  const snapshot = await indexRef(firestore).get()
  const raw = snapshot.get(MEDIA_QUARANTINE_ENTRIES_FIELD)
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, Partial<MediaQuarantineEntry>>)
    : {}
}

/**
 * The quarantine key this request is about.
 *
 * `by: 'asset'` forces the narrow per-document key even when a hash is
 * available. That is a real need, not a convenience: the same bytes can be
 * innocuous in one workspace and the subject of a report in another, and a
 * hash key would take both down. The DEFAULT is still the hash — it is the
 * stronger key, it survives a re-upload, and it covers every document
 * sharing the bytes.
 */
function resolveKey(body: {
  by?: unknown
  contentHash?: unknown
  scopeSegment?: unknown
  mediaId?: unknown
}): { key: string; error?: undefined } | { key?: undefined; error: string } {
  const by = String(body.by ?? 'hash')
  const contentHash = String(body.contentHash ?? '').trim()
  const scopeSegment = String(body.scopeSegment ?? '').trim()
  const mediaId = String(body.mediaId ?? '').trim()
  if (by !== 'hash' && by !== 'asset') {
    return { error: 'by must be "hash" or "asset"' }
  }
  if (by === 'hash') {
    if (!contentHash) {
      return {
        error:
          'contentHash is required for a hash quarantine — send by: "asset" ' +
          'with scopeSegment + mediaId for an asset that has no hash',
      }
    }
    if (!CONTENT_HASH.test(contentHash)) {
      return { error: 'contentHash must be a hex digest' }
    }
    return { key: mediaQuarantineHashKey(contentHash) }
  }
  if (!SCOPE_SEGMENT.test(scopeSegment)) {
    return { error: 'scopeSegment is missing or malformed' }
  }
  if (!MEDIA_ID.test(mediaId)) {
    return { error: 'mediaId is missing or malformed' }
  }
  return { key: mediaQuarantineAssetKey(scopeSegment, mediaId) }
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    body,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
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
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    if (method === 'GET') {
      // Read-only, open to every staff role — during a live incident the
      // person answering "is this file already disabled?" is usually
      // support, not the super-role operator who set it.
      const entries = await readEntries(firestore)
      const probe = String(query?.['key'] ?? '').trim()
      if (probe) {
        const state = normalizeMediaQuarantine(entries[probe], probe)
        return Response.json(
          {
            key: probe,
            quarantined: state != null,
            state,
            notice: state ? mediaQuarantineNotice(state) : null,
            readAtMs: Date.now(),
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      return Response.json(
        {
          records: Object.entries(entries).map(([key, entry]) => ({
            key,
            ...entry,
          })),
          count: Object.keys(entries).length,
          maxEntries: MEDIA_QUARANTINE_MAX_ENTRIES,
          readAtMs: Date.now(),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }

    const action = String(body?.action ?? '')
    if (action !== 'quarantine' && action !== 'release') {
      return Response.json(
        { error: 'action must be "quarantine" or "release"' },
        { status: 400 },
      )
    }
    const resolved = resolveKey(body ?? {})
    if (resolved.error) {
      return Response.json({ error: resolved.error }, { status: 400 })
    }
    const key = resolved.key

    const reason = body?.reason
    if (action === 'quarantine' && !isMediaQuarantineReason(reason)) {
      return Response.json(
        {
          error: `reason must be one of: ${MEDIA_QUARANTINE_REASONS.join(', ')}`,
        },
        { status: 400 },
      )
    }
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, MEDIA_QUARANTINE_MESSAGE_MAX)
        : null
    const note =
      typeof body?.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, MEDIA_QUARANTINE_NOTE_MAX)
        : null
    const untilMs =
      typeof body?.untilMs === 'number' && Number.isFinite(body.untilMs)
        ? body.untilMs
        : null
    if (action === 'quarantine' && untilMs !== null && untilMs <= Date.now()) {
      return Response.json(
        { error: 'untilMs is in the past — that quarantine would never bite' },
        { status: 400 },
      )
    }

    const entriesBefore = await readEntries(firestore)
    const before = entriesBefore[key] ?? null
    // Only a NEW key grows the document; re-stating an existing one is
    // always allowed, so an operator is never blocked from correcting a
    // reason mid-incident.
    if (
      action === 'quarantine' &&
      !before &&
      Object.keys(entriesBefore).length >= MEDIA_QUARANTINE_MAX_ENTRIES
    ) {
      return Response.json(
        {
          error:
            `The quarantine list is full (${MEDIA_QUARANTINE_MAX_ENTRIES}). ` +
            'Release stale entries, or shard the index, before adding more.',
        },
        { status: 409 },
      )
    }

    // Explicit `null`, never `undefined` — a Firestore write must never
    // carry undefined, and an ABSENT key reads as "this record never
    // captured expiry at all", which is exactly the ambiguity the audit
    // trail exists to end.
    const entry: MediaQuarantineEntry | null =
      action === 'quarantine'
        ? {
            reason: reason as MediaQuarantineEntry['reason'],
            message,
            note,
            atMs: Date.now(),
            untilMs,
            actorUid: decoded.uid,
            originScopeSegment:
              typeof body?.scopeSegment === 'string'
                ? String(body.scopeSegment)
                : null,
            originMediaId:
              typeof body?.mediaId === 'string' ? String(body.mediaId) : null,
          }
        : null

    // A merged nested write, so the document is created on the first
    // quarantine and every other entry is left untouched — two operators
    // acting on different assets during the same incident must not
    // overwrite each other.
    await indexRef(firestore).set(
      {
        [MEDIA_QUARANTINE_ENTRIES_FIELD]: {
          [key]: entry ?? FieldValue.delete(),
        },
      },
      { merge: true },
    )
    // The process that took the action enforces it NOW; every other process
    // converges within the reader's 15s TTL.
    invalidateMediaQuarantineCache()

    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ? String(decoded.email) : null,
        action: `mediaQuarantine.${action}`,
        scope: 'asset',
        target: `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}#${key}`,
        before: { quarantined: before != null, ...auditEntryShape(before) },
        after: {
          quarantined: action === 'quarantine',
          ...auditEntryShape(entry),
        },
        at: FieldValue.serverTimestamp(),
      })

    // Read back what was written rather than reporting the intent
    // (AGL-1571). `confirmed: false` means the write returned and the state
    // still disagrees — an alarm, not a quiet success.
    const verifiedEntry = (await readEntries(firestore))[key] ?? null
    const verified = normalizeMediaQuarantine(verifiedEntry, key)
    return Response.json(
      {
        ok: true,
        action,
        key,
        verified,
        readAtMs: Date.now(),
        confirmed: (verified != null) === (action === 'quarantine'),
        notice: verified ? mediaQuarantineNotice(verified) : null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/media-quarantine] failed', error)
    return Response.json(
      { error: 'Media quarantine action failed' },
      { status: 500 },
    )
  }
}

export { handler as GET, handler as POST }
