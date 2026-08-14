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
 * `adminAudit`. It READS one media document in `by: "media"` mode, and
 * only to derive keys from it.
 *
 * ## `by: "media"` — the mode the staff form uses (AGL-1687)
 *
 * The original two modes take a digest or a scope segment, both transcribed
 * by hand from a media document or a CDN URL. That is the right shape for a
 * terminal and the wrong shape for a form, for three reasons a form makes
 * worse rather than better:
 *
 *  1. **Which digest?** A document may carry `contentSha256` AND the legacy
 *     truncated `contentHash`, and AGL-1631 exists because the runbook named
 *     the weak one. An operator should not have to remember; the server
 *     holds the document and can prefer the strong digest itself.
 *  2. **Which scope segment?** The DAM's read derives its per-asset key from
 *     `scope.cdnScope` — `org:{orgId}` or `{hostId}`, never the three-part
 *     form a CDN URL can carry. A hand-typed segment that does not match is
 *     a quarantine that looks set and refuses nothing. Deriving it here from
 *     the same two shapes makes the mismatch structurally impossible.
 *  3. **A release must clear what is actually biting.** An asset can be
 *     covered by more than one key at once — an entry set on the legacy hash
 *     before a replace stamped a strong digest, plus a per-asset entry. A
 *     release that dropped only the preferred key would leave the red
 *     `Disabled` badge in place and read exactly like a lift that failed,
 *     which is the AGL-1571 hazard this whole family is built against. So a
 *     `by: "media"` release removes EVERY key in `mediaQuarantineKeys()`
 *     that currently holds an entry, and audits each removal.
 *
 * It keeps the property `/api/media/quarantine` established: the caller
 * names an ASSET, never a digest, and the keys are derived server-side.
 * That route needs it because accepting digests would make it an oracle for
 * what the platform has taken down anywhere. Here the argument is not
 * secrecy — a `super` operator can already GET the entire deny list — it is
 * that a key the server derives from the document is a key that matches the
 * document, and the three failure modes above are all transcription.
 *
 * `GET` gains the same lookup, unwritten: `?orgId=…&mediaId=…` answers with
 * the asset's keys, which of them are set, and the deny list's size against
 * its cap. Read-only, so it stays open to every staff role — during an
 * incident "is this file already disabled?" is a support question.
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
  mediaQuarantineKey,
  mediaQuarantineKeys,
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
/**
 * A bare org or host id, which is the HALF of a scope segment the caller
 * supplies in `by: "media"` mode. No `:` — the joiner is added here, and
 * accepting one would let a caller hand-build the three-part segment this
 * mode exists to stop them getting wrong.
 */
const SCOPE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The asset a `by: "media"` request names, read from its own document.
 *
 * `scopeSegment` is DERIVED — `org:{orgId}` or `{hostId}`, the same two
 * shapes `resolveMediaScope` produces as `cdnScope` — so a per-asset key set
 * here is byte-identical to the one the DAM looks up. See the module header.
 */
interface ResolvedAsset {
  scopeSegment: string
  mediaId: string
  fileName: string | null
  contentSha256: string | null
  contentHash: string | null
  deleted: boolean
}

async function resolveAsset(
  firestore: AdminFirestore,
  input: { orgId?: unknown; hostId?: unknown; mediaId?: unknown },
): Promise<
  { asset: ResolvedAsset; error?: undefined } | { asset?: undefined; error: { message: string; status: number } }
> {
  const orgId = String(input.orgId ?? '').trim()
  const hostId = String(input.hostId ?? '').trim()
  const mediaId = String(input.mediaId ?? '').trim()
  if (!MEDIA_ID.test(mediaId)) {
    return { error: { message: 'mediaId is missing or malformed', status: 400 } }
  }
  if (Boolean(orgId) === Boolean(hostId)) {
    return {
      error: {
        message: 'Send exactly one of orgId or hostId',
        status: 400,
      },
    }
  }
  if (!SCOPE_ID.test(orgId || hostId)) {
    return { error: { message: 'orgId/hostId is malformed', status: 400 } }
  }
  const scopeRef = orgId
    ? firestore.collection('orgs').doc(orgId)
    : firestore.collection('hosts').doc(hostId)
  const snapshot = await scopeRef.collection('media').doc(mediaId).get()
  if (!snapshot.exists) {
    // 404 rather than a silent empty answer: an operator acting on a media
    // id they misread must be told, not handed a form that quietly
    // quarantines an `asset--…` key matching nothing.
    return { error: { message: 'No such file in that workspace', status: 404 } }
  }
  const value = (field: string): string | null => {
    const raw = snapshot.get(field)
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }
  return {
    asset: {
      scopeSegment: orgId ? `org:${orgId}` : hostId,
      mediaId,
      fileName: value('fileName'),
      contentSha256: value('contentSha256'),
      contentHash: value('contentHash'),
      // Soft-deleted assets are still worth quarantining — a DMCA notice
      // does not stop mattering because the customer moved the file to the
      // trash, and a restore would bring it straight back. Reported rather
      // than refused.
      deleted: Boolean(snapshot.get('deletedAt')),
    },
  }
}

/**
 * The media-mode half of a response: the asset the server actually read,
 * and every key that could refuse it with what is set right now. The page
 * renders this rather than inferring "disabled" from the action it just
 * took — the same reason the lockdown cards render a re-read verdict.
 */
function assetPayload(
  asset: ResolvedAsset | null,
  key: string,
  assetKeys: string[],
  entries: Record<string, Partial<MediaQuarantineEntry>>,
) {
  if (!asset) return {}
  const resolved = asset
  return {
    asset: {
      scopeSegment: resolved.scopeSegment,
      mediaId: resolved.mediaId,
      fileName: resolved.fileName,
      hasStrongDigest: resolved.contentSha256 != null,
      hasLegacyDigest: resolved.contentHash != null,
      deleted: resolved.deleted,
    },
    keyKind: describeKeyKind(key, resolved),
    assetKeys: assetKeys.map((candidate) => ({
      key: candidate,
      kind: describeKeyKind(candidate, resolved),
      set: entries[candidate] != null,
    })),
  }
}

/** Which of the three key kinds `key` is, for the operator's benefit. */
function describeKeyKind(
  key: string,
  asset: ResolvedAsset,
): 'sha256' | 'legacy' | 'asset' {
  if (asset.contentSha256 && key === mediaQuarantineHashKey(asset.contentSha256))
    return 'sha256'
  if (asset.contentHash && key === mediaQuarantineHashKey(asset.contentHash))
    return 'legacy'
  return 'asset'
}

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
      // The staff form's lookup: name an asset, get back every key that
      // could refuse it and which of them are set. Unwritten, so it stays
      // open to every staff role like the rest of GET.
      const lookupMediaId = String(query?.['mediaId'] ?? '').trim()
      if (lookupMediaId) {
        const resolved = await resolveAsset(firestore, {
          orgId: query?.['orgId'],
          hostId: query?.['hostId'],
          mediaId: lookupMediaId,
        })
        if (resolved.error) {
          return Response.json(
            { error: resolved.error.message },
            { status: resolved.error.status },
          )
        }
        const asset = resolved.asset
        const keys = mediaQuarantineKeys(asset)
        return Response.json(
          {
            asset: {
              scopeSegment: asset.scopeSegment,
              mediaId: asset.mediaId,
              fileName: asset.fileName,
              hasStrongDigest: asset.contentSha256 != null,
              hasLegacyDigest: asset.contentHash != null,
              deleted: asset.deleted,
            },
            // In preference order, so the first entry is the one a
            // quarantine would be written under.
            keys: keys.map((key) => ({
              key,
              kind: describeKeyKind(key, asset),
              state: normalizeMediaQuarantine(entries[key], key),
              // The internal rationale, which `normalizeMediaQuarantine`
              // drops on purpose so it can never reach a customer surface.
              // THIS route is staff-gated end to end and its plain listing
              // already returns it — an operator deciding whether to lift a
              // takedown needs the notice number that set it.
              note:
                typeof entries[key]?.note === 'string'
                  ? entries[key].note
                  : null,
            })),
            quarantined: keys.some((key) => entries[key] != null),
            count: Object.keys(entries).length,
            maxEntries: MEDIA_QUARANTINE_MAX_ENTRIES,
            readAtMs: Date.now(),
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        )
      }
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
    /**
     * `by: "media"` resolves the asset first and derives every key from it;
     * the two original modes keep taking the key the caller states. See the
     * module header for why the form uses the first one.
     */
    const mediaMode = String(body?.by ?? '') === 'media'
    let asset: ResolvedAsset | null = null
    let key: string
    /** Every key that could refuse this asset. Media mode only. */
    let assetKeys: string[] = []
    if (mediaMode) {
      const found = await resolveAsset(firestore, body ?? {})
      if (found.error) {
        return Response.json(
          { error: found.error.message },
          { status: found.error.status },
        )
      }
      asset = found.asset
      assetKeys = mediaQuarantineKeys(asset)
      // `prefer: "asset"` is the deliberate narrow choice: take down THIS
      // workspace's copy when the same bytes are legitimate elsewhere. The
      // default stays the digest, which is the stronger key and the one that
      // survives a re-upload.
      const preferAsset = String(body?.prefer ?? 'hash') === 'asset'
      const derived = preferAsset
        ? mediaQuarantineAssetKey(asset.scopeSegment, asset.mediaId)
        : mediaQuarantineKey(asset)
      if (!derived) {
        return Response.json(
          { error: 'Could not derive a quarantine key for that file' },
          { status: 500 },
        )
      }
      key = derived
    } else {
      const resolved = resolveKey(body ?? {})
      if (resolved.error) {
        return Response.json({ error: resolved.error }, { status: 400 })
      }
      key = resolved.key
    }

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
            // In media mode these come from the document the server read,
            // not from what the caller typed — the origin fields are the
            // audit trail's only record of WHICH copy an operator was
            // looking at, and a mistyped one makes that record a lie.
            originScopeSegment:
              asset?.scopeSegment ??
              (typeof body?.scopeSegment === 'string'
                ? String(body.scopeSegment)
                : null),
            originMediaId:
              asset?.mediaId ??
              (typeof body?.mediaId === 'string' ? String(body.mediaId) : null),
          }
        : null

    /**
     * Which keys this request actually touches.
     *
     * A quarantine writes exactly one — the preferred key. A media-mode
     * RELEASE clears every key currently holding an entry, because an asset
     * can be covered by two at once and a half-lift leaves the `Disabled`
     * badge up while reporting success. When none are set, the preferred key
     * is still named so the no-op is audited rather than vanishing.
     */
    const actedKeys =
      mediaMode && action === 'release'
        ? assetKeys.filter((candidate) => entriesBefore[candidate] != null)
        : [key]
    if (!actedKeys.length) actedKeys.push(key)

    // A merged nested write, so the document is created on the first
    // quarantine and every other entry is left untouched — two operators
    // acting on different assets during the same incident must not
    // overwrite each other.
    await indexRef(firestore).set(
      {
        [MEDIA_QUARANTINE_ENTRIES_FIELD]: Object.fromEntries(
          actedKeys.map((acted) => [acted, entry ?? FieldValue.delete()]),
        ),
      },
      { merge: true },
    )
    // The process that took the action enforces it NOW; every other process
    // converges within the reader's 15s TTL.
    invalidateMediaQuarantineCache()

    // One row PER KEY. A release that cleared two entries is two facts, and
    // collapsing them would leave the second one with no record that it was
    // ever in force.
    for (const acted of actedKeys) {
      const actedBefore = entriesBefore[acted] ?? null
      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ? String(decoded.email) : null,
        action: `mediaQuarantine.${action}`,
        scope: 'asset',
        target: `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}#${acted}`,
        before: {
          quarantined: actedBefore != null,
          ...auditEntryShape(actedBefore),
        },
        after: {
          quarantined: action === 'quarantine',
          ...auditEntryShape(entry),
        },
        at: FieldValue.serverTimestamp(),
      })
    }

    // Read back what was written rather than reporting the intent
    // (AGL-1571). `confirmed: false` means the write returned and the state
    // still disagrees — an alarm, not a quiet success.
    const entriesAfter = await readEntries(firestore)
    const verified = normalizeMediaQuarantine(entriesAfter[key] ?? null, key)
    /**
     * In media mode a release is only confirmed when NO key can still refuse
     * the asset. Checking the one preferred key would report success while
     * the file stayed dark — the precise shape of the failure AGL-1571's
     * read-back discipline exists to catch.
     */
    const confirmed =
      mediaMode && action === 'release'
        ? assetKeys.every((candidate) => entriesAfter[candidate] == null)
        : (verified != null) === (action === 'quarantine')
    return Response.json(
      {
        ok: true,
        action,
        key,
        keys: actedKeys,
        verified,
        readAtMs: Date.now(),
        confirmed,
        notice: verified ? mediaQuarantineNotice(verified) : null,
        ...assetPayload(asset, key, assetKeys, entriesAfter),
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
