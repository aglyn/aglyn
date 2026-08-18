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
  checkEntitlement,
  hostScopeToken,
  isOrgWideMember,
  memberScopeTokens,
  ORG_SCOPE_TOKEN,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  featureLockdownRefusal,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgDoc,
  getOrgForHost,
  lockdownJsonResponse,
  type LockdownVerdictOptions,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import type { LockdownFeatureKey } from '@aglyn/aglyn/server'

export interface MediaScope {
  /** Storage prefix + Firestore parent: `hosts/{id}` or `orgs/{id}`. */
  base: string
  /** `hosts` | `orgs` — the parent collection. */
  collection: 'hosts' | 'orgs'
  /** Host or org id. */
  scopeId: string
  /**
   * The OWNING org, for both scope kinds (AGL-2075). A host scope's quota has
   * always ridden the org doc; the org's id was simply thrown away with it,
   * which is why the storage band could only ever be asked per scope.
   */
  orgId: string
  /** Firestore doc ref of the scope (media/mediaFolders/counters parent). */
  scopeRef: FirebaseFirestore.DocumentReference
  /** Billing/entitlement doc — the owning org either way (AGL-238). */
  billing: Record<string, unknown>
  /** Segment used in cdnPath — `{hostId}` or `org:{orgId}`. */
  cdnScope: string
  /**
   * What the CALLER may see (AGL-1043), as scope tokens. Distinct from the
   * scope itself: two members can address the same org library and be
   * entitled to different assets within it. Consumers filter with
   * `scopeAllows` rather than assuming access to everything under `base`.
   */
  viewerTokens: string[]
  /** Whether the caller's reach is the whole org rather than named sites. */
  viewerOrgWide: boolean
}

/** Whether the caller behind a resolved scope may see one asset/folder. */
export function scopeAllows(
  scope: Pick<MediaScope, 'viewerTokens' | 'viewerOrgWide'>,
  visibleTo: unknown,
): boolean {
  if (scope.viewerOrgWide) return true
  return visibleToTokens(
    Array.isArray(visibleTo) ? (visibleTo as string[]) : undefined,
    scope.viewerTokens,
  )
}

export interface MediaScopeError {
  status: number
  message: string
  /**
   * Prebuilt refusal, when the error is richer than `{status, message}` —
   * today the 423 lockdown body (AGL-1506). Callers return it as-is:
   * `error.response ?? Response.json({error: message}, {status})`.
   */
  response?: Response
}

/**
 * Lockdown verdict as a `MediaScopeError` (AGL-1506). Lives here because
 * this resolver is the one chokepoint every media mutation route passes
 * through, and it already holds the docs the verdict wants — the org doc
 * (`billing`) either way, the host doc on the host branch — so the org and
 * host scopes cost no extra read. Null = not locked.
 */
async function lockdownScopeError(
  options: LockdownVerdictOptions,
  feature?: LockdownFeatureKey,
): Promise<MediaScopeError | null> {
  const state = await getLockdownVerdict(options)
  if (state) {
    return {
      status: 423,
      message: `Locked: ${state.reason}`,
      response: lockdownJsonResponse(state),
    }
  }
  // Feature lockdown (AGL-1510), composed after the scope verdict: the
  // three INGRESS routes (upload, upload-url, replace) pass
  // `feature: 'uploads'`; sign/folders/references/restore do not — an
  // uploads lock stops new bytes arriving, not the library working. Staff
  // bypass at the feature stage is granted (uploads=true in
  // LOCKDOWN_FEATURE_STAFF_BYPASS): the responder needs to upload a test
  // asset to verify the malware fix before lifting the lock.
  if (feature) {
    const refusal = await featureLockdownRefusal({
      feature,
      staff: options.staff,
    })
    if (refusal) {
      return { status: 423, message: `Locked: ${feature}`, response: refusal }
    }
  }
  return null
}

/**
 * Media APIs serve two scopes (org DAM parity): a host's own library and
 * the organization's shared one. Resolution authenticates the caller for
 * whichever identity the request carries — host `memberRoles`
 * admin/editor, or org roster role owner/admin/editor — and hands back
 * the Storage/Firestore base plus the billing doc for quota gates.
 */
export async function resolveMediaScope(
  body: Record<string, unknown> | undefined,
  query: Partial<Record<string, string | string[]>>,
  uid: string,
  options?: {
    /** Verified `staff` claim of the caller — the lockdown un-panic bypass. */
    staff?: boolean
    /**
     * Feature gate this call enforces (AGL-1510). Ingress routes pass
     * `'uploads'`; read/organize routes omit it.
     */
    feature?: LockdownFeatureKey
    /**
     * READ-ONLY discrimination (AGL-1625). This resolver takes no `request`
     * — every caller is POST-shaped and the method would say `write` for all
     * of them anyway — so a POST-shaped READ has to declare itself here.
     *
     * ABSENT MEANS `write`, unchanged: seven of the eight media routes
     * mutate, and the one that does not is named at its own call site rather
     * than inferred from a path. A route added later inherits the refusing
     * default until someone decides otherwise, which is the direction
     * AGL-1511 chose and this parameter must not quietly reverse.
     *
     * Note this is deliberately NOT the same axis as `feature`: an uploads
     * lock stops new bytes arriving, a read-only lock stops the library
     * being reorganized. A route can be subject to both.
     */
    intent?: LockdownVerdictOptions['intent']
  },
): Promise<{ scope?: MediaScope; error?: MediaScopeError }> {
  const firestore = firebaseAdmin.app().firestore()
  const orgId = String(body?.['orgId'] ?? query['orgId'] ?? '') || null
  const hostId = String(body?.['hostId'] ?? query['hostId'] ?? '') || null

  if (orgId) {
    const membership = await resolveOrgMembership(uid, orgId)
    const role = membership?.member.role
    if (!role || role === 'viewer') {
      return {
        error: {
          status: 403,
          message: 'Editing the organization library requires the editor role',
        },
      }
    }
    const org = (await getOrgDoc(orgId)) ?? {}
    const locked = await lockdownScopeError(
      {
        staff: options?.staff,
        uid,
        org,
        intent: options?.intent,
      },
      options?.feature,
    )
    if (locked) return { error: locked }
    return {
      scope: {
        base: `orgs/${orgId}`,
        collection: 'orgs',
        scopeId: orgId,
        orgId,
        scopeRef: firestore.collection('orgs').doc(orgId),
        billing: org as Record<string, unknown>,
        cdnScope: `org:${orgId}`,
        // The stored projection when there is one — this used to always
        // recompute, which is the same answer for every member the
        // AGL-1040 backfill reached and a DIFFERENT one for anybody whose
        // `scopeTokens` were later narrowed by `revokeHostAccess` without
        // `hostAccess` being rewritten. One rule, one helper.
        viewerTokens: memberScopeTokens(membership?.member),
        viewerOrgWide: isOrgWideMember(membership?.member),
      },
    }
  }

  if (!hostId) {
    return { error: { status: 400, message: 'Missing hostId or orgId' } }
  }
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return { error: { status: 404, message: 'Unknown site' } }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return { error: { status: 403, message: 'Not a site admin' } }
  }
  const resolvedOrg = await getOrgForHost(hostId)
  const billing = resolvedOrg?.org ?? {}
  const locked = await lockdownScopeError(
    {
      staff: options?.staff,
      uid,
      org: billing,
      host: hostSnapshot.data(),
      intent: options?.intent,
    },
    options?.feature,
  )
  if (locked) return { error: locked }
  return {
    scope: {
      base: `hosts/${hostId}`,
      collection: 'hosts',
      scopeId: hostId,
      orgId: resolvedOrg?.orgId ?? '',
      scopeRef: hostRef,
      billing: billing as Record<string, unknown>,
      cdnScope: hostId,
      // A host's own library is private by construction and its docs carry
      // no `visibleTo`; the memberRoles check above is the whole gate.
      viewerTokens: [ORG_SCOPE_TOKEN, hostScopeToken(hostId)],
      viewerOrgWide: true,
    },
  }
}

/** Reserved object-metadata key we must never let callers set/clobber. */
const RESERVED_METADATA_KEYS = new Set(['firebaseStorageDownloadTokens'])

export const CUSTOM_METADATA_MAX_PAIRS = 30
export const CUSTOM_METADATA_KEY_MAX = 64
export const CUSTOM_METADATA_VALUE_MAX = 1024

/**
 * Normalize user-supplied custom metadata (AGL-822) before it touches the
 * Storage object or the Firestore mirror: coerce to string/string, trim
 * keys, drop empties/reserved keys, and cap key/value length and pair
 * count so a client can't bloat object metadata.
 */
export function sanitizeCustomMetadata(
  raw: unknown,
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const clean: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const key = String(rawKey ?? '').trim().slice(0, CUSTOM_METADATA_KEY_MAX)
    if (!key || RESERVED_METADATA_KEYS.has(key)) continue
    if (rawValue === null || rawValue === undefined) continue
    const value = String(rawValue).slice(0, CUSTOM_METADATA_VALUE_MAX)
    clean[key] = value
    if (Object.keys(clean).length >= CUSTOM_METADATA_MAX_PAIRS) break
  }
  return clean
}

/** Folder names become real Storage path segments — keep them tame. */
export function sanitizeFolderSegment(name: unknown): string {
  return (
    String(name ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'folder'
  )
}

/**
 * Materialized Storage path for a folder (AGL: real folders): walks the
 * mediaFolders parent chain and joins sanitized names. Empty string for
 * root/unknown folders — a stale id files the asset at the root.
 */
export async function folderStoragePath(
  scopeRef: FirebaseFirestore.DocumentReference,
  folderId: string | null,
): Promise<string> {
  const segments: string[] = []
  let current: string | null = folderId
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const snapshot = await scopeRef
      .collection('mediaFolders')
      .doc(current)
      .get()
    if (!snapshot.exists) break
    segments.unshift(sanitizeFolderSegment(snapshot.get('name')))
    current = (snapshot.get('parentId') as string | null) ?? null
  }
  return segments.join('/')
}

/**
 * The object path recorded on the media doc, with the legacy flat layout
 * as fallback for assets uploaded before real folders existed.
 */
export function mediaObjectPath(
  mediaSnapshot: FirebaseFirestore.DocumentSnapshot,
  base: string,
): string {
  const stored = mediaSnapshot.get('storagePath')
  return typeof stored === 'string' && stored
    ? stored
    : `${base}/media/${mediaSnapshot.id}`
}

/**
 * Is this folder request the scope cascade's PREVIEW — the count, not the
 * cascade? (AGL-1694)
 *
 * `POST /api/media/folders` carries six actions and five of them write, so
 * the route cannot declare a read intent; only this one request SHAPE can.
 * The predicate is deliberately narrow and deliberately boolean: it names
 * the action AND requires `preview === true` exactly, because both halves
 * come from a client and `{action: 'delete', preview: true}` must not buy a
 * delete a reader's verdict.
 *
 * It returns a fact about the request, never an intent. The read-intent
 * literal itself stays at the route's call site, because
 * `lockdown-read-intent-audit.spec.ts` walks route files for it and pins
 * this module against ever spelling one — a declaration this module made on
 * a route's behalf is a relaxation that audit could not see.
 *
 * The route's preview branch tests the same predicate, so the shape that
 * skips the writes and the shape that is called a read cannot drift apart.
 */
export function isFolderScopePreviewRequest(
  body: Record<string, unknown> | undefined,
): boolean {
  return (
    String(body?.['action'] ?? '') === 'set-scope' && body?.['preview'] === true
  )
}

/**
 * The `cdnPath` field value for a media doc — a path, or the sentinel that
 * removes it (AGL-1051).
 *
 * One helper because three writers decide this — upload, replace, and the
 * `set-private` toggle — and three copies of a rule is how the third drifts.
 * It already had: `set-private` minted a path on un-privating with no
 * entitlement check, so an org without `mediaCdn` could obtain a CDN URL
 * that upload and replace would both have withheld.
 *
 * Two independent reasons to have no path, and both must hold to get one:
 * the plan does not include CDN delivery, or the asset is PRIVATE — and a
 * private asset's missing `cdnPath` is not a detail, it is the mechanism
 * that keeps it out of pickers and page nodes.
 */
/**
 * The slice of a folder's scope cascade one request writes (AGL-1045).
 *
 * Split out of the route because it is the only arithmetic in that action
 * and it is where a resumable cursor goes wrong: an off-by-one leaves the
 * last asset unscoped — a file the caller was told is restricted and is
 * not — and a cursor past the end must report `done` rather than loop.
 * Hostile input is normal here: `chunkStart` comes from the client.
 */
export function scopeCascadeSlice(options: {
  /** Docs in the whole operation — the folder plus its subtree assets. */
  total: number
  /** Client cursor. Anything not a sane index starts from the beginning. */
  chunkStart?: unknown
  /** Client slice size. Absent/unusable means "the rest of it". */
  chunkSize?: unknown
  /** Hard ceiling — Firestore's cap on one batched commit. */
  batchLimit: number
}): { start: number; size: number; next: number; done: boolean } {
  const total = Math.max(0, Math.trunc(options.total) || 0)
  const rawStart = Math.trunc(Number(options.chunkStart ?? 0))
  const start = Math.min(
    total,
    Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0,
  )
  const rawSize = Math.trunc(Number(options.chunkSize ?? 0))
  const requested =
    Number.isFinite(rawSize) && rawSize > 0
      ? Math.min(rawSize, options.batchLimit)
      : total - start
  const size = Math.max(0, Math.min(requested, total - start))
  const next = start + size
  return { start, size, next, done: next >= total }
}

export function mediaCdnPathUpdate(options: {
  /** Org billing doc — `MediaScope.billing`. */
  billing: Record<string, unknown> | undefined
  /** `MediaScope.cdnScope` — `{hostId}` or `org:{orgId}`. */
  cdnScope: string
  mediaId: string
  isPrivate: boolean
}): string | FirebaseFirestore.FieldValue {
  const allowed =
    checkEntitlement(options.billing as never, 'mediaCdn') && !options.isPrivate
  return allowed
    ? `/api/media/cdn/${options.cdnScope}/${options.mediaId}`
    : firebaseAdmin.firestore.FieldValue.delete()
}
