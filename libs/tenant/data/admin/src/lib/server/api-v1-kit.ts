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
 * What every `/v1` resource handler shares (AGL-2606): the context the
 * pipeline hands it, the scope check, the cursor, serialization and
 * idempotency helpers, and the shape a usage figure is published in.
 *
 * One copy for every resource, whoever serves it. A second copy of the
 * cursor grammar or the idempotency claim in any handler is exactly the drift
 * these exist to prevent: a cursor one resource encodes and another cannot
 * decode, or a claim digest that collides across resources because one copy
 * forgot the org. They are the data layer's because a resource a plugin
 * serves (`api-v1-resources.ts`) is a handler too, and a plugin may not
 * import the console.
 */
import { type AttemptClaim, claimAttempt } from '@aglyn/aglyn/server'
import type { AglynOrganization } from '@aglyn/aglyn'
import {
  type CoreSiteKey,
  holdsSiteKey,
  siteKeyRefusal,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import {
  apiJson,
  ApiErrors,
  decodeCursor,
  encodeCursor,
  parseLimit,
  withResponseHeaders,
} from './api-http'
import type { ApiScope } from './api-keys'
import type { LockdownVerdictOptions } from './lockdown'

// ── The context ─────────────────────────────────────────────────────────────

/** What the pipeline resolved for one authenticated request. */
export interface ApiV1Context {
  orgId: string
  keyId: string
  /**
   * The key's name, as the organization labeled it, or null for a key with
   * none. What a write made with the key is attributed to in the console's
   * activity feeds (AGL-2632) — the key is the actor, and "API key Zapier"
   * is its name the way an address is a person's.
   */
  keyName: string | null
  /**
   * Which kind of credential this is (AGL-4225): an organization's API key,
   * or an app a person connected by signing in. Absent means an API key, the
   * only kind there was. What a write is attributed to depends on it — see
   * {@link apiActorLabel} and {@link apiActorFields}.
   */
  credential?: 'api_key' | 'connected_app'
  /**
   * The person a connected app acts for (AGL-4235), from the verified
   * credential. Absent for an API key, which is the workspace's own
   * credential with no person behind it.
   */
  uid?: string
  /**
   * The site a `/v1/sites/{siteId}/…` request names, as the site router
   * already read it (AGL-4235): set on the context the router hands every
   * site-scoped handler, plugin handlers included, so a handler asks for the
   * site document once. Absent outside a site path.
   */
  site?: { id: string; snapshot: FirebaseFirestore.DocumentSnapshot }
  scopes: ApiScope[]
  org: Partial<AglynOrganization>
  firestore: FirebaseFirestore.Firestore
  /** Rate-limit headers to echo on every response for this request. */
  headers: Record<string, string>
  /**
   * Loads every plugin's console server surface, for a handler that checks
   * a write against something other plugins register there — a custom field
   * type. Absent where the caller has no plugin loader, and then nothing
   * beyond what is already registered is loaded.
   */
  loadPluginSurfaces?: () => Promise<void>
}

/** True when the credential is an app a person connected, not an API key. */
export function isConnectedAppContext(context: Pick<ApiV1Context, 'credential'>): boolean {
  return context.credential === 'connected_app'
}

/**
 * Who a write made with this credential is, in words: `API key Zapier` or
 * `Connected app Cursor`. The name is the one the organization gave the key,
 * or the one the app registered under.
 */
export function apiActorLabel(context: Pick<ApiV1Context, 'credential' | 'keyName'>): string {
  const connected = isConnectedAppContext(context)
  if (!context.keyName) return connected ? 'A connected app' : 'An API key'
  return connected ? `Connected app ${context.keyName}` : `API key ${context.keyName}`
}

/**
 * The field an activity entry names its writer by: `apiKeyName` for a key,
 * `connectedAppName` for a connection — never one dressed as the other.
 */
export function apiActorFields(
  context: Pick<ApiV1Context, 'credential' | 'keyName'>,
): { apiKeyName?: string | null; connectedAppName?: string | null } {
  return isConnectedAppContext(context)
    ? { connectedAppName: context.keyName }
    : { apiKeyName: context.keyName }
}

/** Return a 403 unless the key carries `scope`; otherwise `null` (proceed). */
export function requireScope(
  context: ApiV1Context,
  scope: ApiScope,
): Response | null {
  return context.scopes.includes(scope)
    ? null
    : ApiErrors.insufficientScope(scope, context.headers)
}

// ── Serialization ───────────────────────────────────────────────────────────

/** Firestore values → JSON-safe values (Timestamps become ISO strings). */
export function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

// ── Cursor pagination over a Firestore collection ───────────────────────────

export interface Paginated {
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
  nextCursor: string | null
}

export async function paginate(
  query: FirebaseFirestore.Query,
  url: URL,
): Promise<Paginated> {
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  let q = query.orderBy(FieldPath.documentId()).limit(limit + 1)
  if (cursor) q = q.startAfter(cursor)
  const snap = await q.get()
  const docs = snap.docs.slice(0, limit)
  const nextCursor =
    snap.docs.length > limit && docs.length > 0
      ? encodeCursor(docs[docs.length - 1].id)
      : null
  return { docs, nextCursor }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

// ── Idempotency ─────────────────────────────────────────────────────────────

/**
 * The operations a claim can belong to. Hashed into the digest, so a key
 * reused across two of them is two separate attempts — see `claimWrite`.
 *
 * The CRM pairs (AGL-2606) follow the contact pair's shape: a create and a
 * delete per resource, sharing the organization as their scope suffix and
 * kept apart by the kind alone.
 */
export type ClaimKind =
  | 'records'
  | 'record-deletes'
  | 'datasets'
  | 'dataset-deletes'
  | 'form-submission-deletes'
  | 'contacts'
  | 'contact-deletes'
  // A merge destroys the source contact (AGL-2625), so it claims like a
  // delete and records the survivor's view as its receipt.
  | 'contact-merges'
  | 'media'
  | 'sites'
  | 'companies'
  | 'company-deletes'
  | 'deals'
  | 'deal-deletes'
  | 'tasks'
  | 'task-deletes'
  | 'activities'
  | 'activity-deletes'
  | 'lead-conversions'
  // A lead created over the API (AGL-3231) — the door updates an existing
  // address, so the receipt is the lead's view either way.
  | 'lead-creates'
  | 'email-templates'
  | 'email-template-deletes'
  // A product created over the API (AGL-4235), scoped within its site.
  | 'product-creates'
  // A page created over the API (AGL-4235), scoped within its site.
  | 'page-creates'
  // A set of edits to a page's draft (AGL-4235): inserts are not repeat-safe,
  // so a retried request must replay its first answer.
  | 'page-content-edits'

/**
 * Take an exclusive claim on one write attempt (AGL-1709), and translate the
 * transport-agnostic result into a v1 `Response`.
 *
 * The claim itself is the shared `claimAttempt` (AGL-1697, `220217133`) — an
 * unconditional `create()`, where Firestore's rejection on an existing document
 * IS the dedupe primitive. This resource used to run its own read-then-create,
 * which is the exact race the mechanism exists to prevent: two concurrent
 * requests carrying one key both read "no prior key", both fall through, both
 * create. Worse than no check at all in one respect, because it made the path
 * look protected. Adopting the shared claim rather than fixing the local copy
 * is the point — POS, refunds and the REST API now answer this question once.
 *
 * `scopeId` carries the ORG as well as the dataset. The helper hashes
 * `{kind}:{scopeId}:{key}` and its plugin callers pass a globally unique host
 * id, but a dataset id is only meaningful under its org — and the claim stores
 * the response body, so a cross-org digest collision would replay one tenant's
 * record to another. The org belongs in the digest, not just in the swept
 * field. Scoping by the DATASET is what `apps/docs/api/conventions.md` already
 * publishes ("replay is looked up within the dataset you're posting to"); the
 * old org-only digest only reached that outcome by accident, by reading a
 * `recordId` that did not exist in the other dataset and falling through — and
 * having fallen through, its key write failed and was swallowed, so the key
 * never deduped there at all.
 *
 * NOTE: the digest changes, so keys stored under the old `orgId:key` shape are
 * orphaned and a retry straddling this deploy creates a duplicate. Accepted —
 * the API is pre-beta and the alternative is carrying the race forever.
 *
 * `kind` separates the create's claims from the delete's (AGL-1710). The
 * helper hashes it into the digest for exactly this reason, and the two record
 * different response BODIES — a record view versus a `{ deleted: true }`
 * receipt. Sharing one namespace would let a key reused across both operations
 * replay the create's record to a delete, which a client parses as a success
 * and which no amount of documentation makes safe. `POST` keeps `records`
 * verbatim: changing its digest orphans keys in flight, and AGL-1709 already
 * paid that cost once.
 *
 * `scopeSuffix` is the object the key is scoped WITHIN — a dataset id for the
 * record operations and for `DELETE /v1/datasets/{id}`, the site for
 * `DELETE …/form-submissions/{id}`, and `*` — the ORGANIZATION — for
 * `POST /v1/datasets` (AGL-2126), where there is no dataset id yet because
 * the request is what creates one, and for both contact writes (AGL-2276),
 * where the organization genuinely IS the containing object: contacts are
 * org-scoped (AGL-237), so there is no site or parent collection to scope to
 * and pretending otherwise would invent a boundary the data does not have.
 * `*` cannot collide with a resource id: `createResourceUid()` never emits
 * one, and the `kind` is separate anyway. The suffix is not the whole story —
 * `kind` is hashed in too, which is what keeps a create's key from replaying
 * into a delete, and what keeps `contacts` and `contact-deletes` apart while
 * they share a suffix.
 *
 * This paragraph used to say `*` covered "the two that act on the dataset
 * collection itself", which the delete has never done — it passes
 * `datasetRef.id`. The published contract in `apps/docs/api/conventions.md` was
 * written from this comment and inherited the error (AGL-2218), which is the
 * argument for reading the call rather than the docblock above it.
 */
export async function claimWrite(
  ctx: ApiV1Context,
  scopeSuffix: string,
  key: string | null,
  kind: ClaimKind,
): Promise<{ claim: AttemptClaim } | { replay: Response }> {
  const result = await claimAttempt(ctx.firestore, {
    kind,
    scopeId: `${ctx.orgId}:${scopeSuffix}`,
    // The field `eraseOrgIdempotencyKeys` sweeps on (AGL-1448).
    orgId: ctx.orgId,
    key: key ?? '',
    busyMessage: 'A request with this Idempotency-Key is still in progress',
  })
  if ('claim' in result) return result
  // The helper is transport-agnostic and answers `{ status, body }`; its
  // plugin callers hand that straight to a pages-API `res.json()`. v1 publishes
  // a `{ error: { type, message, code } }` envelope that clients branch on, so
  // the refusal is rebuilt here rather than leaking the helper's bare
  // `{ error: '<sentence>' }` onto a documented surface.
  if (result.replay.status === 409) {
    return {
      replay: ApiErrors.conflict({
        message: 'A request with this Idempotency-Key is still in progress',
        code: 'idempotency_in_progress',
        headers: ctx.headers,
      }),
    }
  }
  // Settled: replay the ORIGINAL response, from the stored body rather than a
  // fresh read — which is what makes it survive a record since edited or
  // deleted. The old lookup replayed only while the record still existed and
  // fell through to a SECOND create otherwise.
  return {
    replay: apiJson(result.replay.body, {
      status: result.replay.status,
      headers: ctx.headers,
    }),
  }
}

// ── Usage ───────────────────────────────────────────────────────────────────

/**
 * One metered dimension, as published (AGL-2277).
 *
 * `included`/`remaining` are `null` for an UNLIMITED band rather than the
 * sentinel itself: `UNLIMITED` is `Number.POSITIVE_INFINITY`, which
 * `JSON.stringify` silently turns into `null` anyway — so the choice is
 * between a `null` that means "unlimited" on purpose and the same `null`
 * arriving by accident, indistinguishable from a bug. Stated explicitly, and
 * documented, so an integrator can branch on it.
 *
 * `metered` is the field that actually answers "what happens when I cross
 * this" — true means the excess bills, false means the next call is refused.
 * It is read off the plan's own overage rate through the `check*Quota`
 * helpers rather than re-derived here, because a second copy of that rule
 * would drift from the one the enforcement path uses, and this endpoint's
 * whole value is telling a customer what the enforcement path will do.
 */
export function usageBand(
  used: number,
  included: number,
  remaining: number,
  overageRateUsd: number | null,
) {
  const unlimited = !Number.isFinite(included)
  return {
    used,
    included: unlimited ? null : included,
    remaining: unlimited ? null : remaining,
    metered: overageRateUsd !== null,
  }
}

// ── Ownership ───────────────────────────────────────────────────────────────

/** Whether `hostId` is one of the authenticated organization's own sites. */
export function orgOwnsHost(ctx: ApiV1Context, hostId: string): boolean {
  const hosts = (ctx.org.hosts ?? {}) as Record<string, unknown>
  return Boolean(hosts[hostId])
}

// ── The person behind a connected app, on one site (AGL-4235) ───────────────

/** A host document as a snapshot (`get`) or as its data. */
type HostDocumentInHand = Parameters<typeof holdsSiteKey>[0]

/**
 * May the person a connected app acts for SEE this site at all? The rules'
 * `isHostMember`: any role in the site's `memberRoles` projection, which
 * carries no entry for someone who is not on the site. The same test the
 * console's own routes make with the host document in hand
 * (`/api/media/storage`, `/api/hosts/usage`).
 *
 * An API key is not asked: it is the workspace's own credential with no
 * person behind it, and `orgOwnsHost` is the whole of its reach. A connected
 * app with no uid fails closed.
 */
export function holdsSiteMembership(
  context: Pick<ApiV1Context, 'credential' | 'uid'>,
  hostDoc: HostDocumentInHand,
): boolean {
  if (!isConnectedAppContext(context)) return true
  if (!context.uid || !hostDoc) return false
  const roles =
    typeof (hostDoc as { get?: unknown }).get === 'function'
      ? (hostDoc as { get(field: string): unknown }).get('memberRoles')
      : (hostDoc as { memberRoles?: unknown }).memberRoles
  return Boolean((roles as Record<string, unknown> | null | undefined)?.[context.uid])
}

/**
 * Refuse a connected app whose person does not hold `key` on this site
 * (AGL-4235), by the same `holdsSiteKey` the console's doors ask, so an app
 * can do on a site exactly what its person could do there in the console and
 * nothing more. `403 site_permission_required`, naming the permission the
 * way the console does. A connected app with no uid fails closed.
 *
 * An API key passes: it is the workspace's own credential with no person
 * behind it, so there is no member to ask about (the docblock on
 * `handlePublish` sets this out). Its reach is its scopes and the
 * workspace's ownership of the site.
 */
export function requireSitePermission(
  context: ApiV1Context,
  hostDoc: HostDocumentInHand,
  key: CoreSiteKey,
): Response | null {
  if (!isConnectedAppContext(context)) return null
  if (context.uid && holdsSiteKey(hostDoc, context.uid, key)) return null
  return ApiErrors.sitePermissionRequired(siteKeyRefusal(key), context.headers)
}

/**
 * The SITE-level lock and takedown verdict for this request (AGL-4235): the
 * one `lockdownRefusal`, given the site document as well as the workspace and
 * the person, with this request's rate-limit headers merged on exactly as
 * `authenticateApiV1` merges them onto the workspace-level refusal. The
 * method decides, as it does there: a read-only lock passes a GET and refuses
 * a write; a full lock refuses both.
 *
 * Loaded on first use: the lock readers bring the Admin SDK's module graph,
 * which nothing else in this kit needs.
 */
export async function siteLockRefusal(
  context: ApiV1Context,
  request: Request,
  hostData: LockdownVerdictOptions['host'],
): Promise<Response | null> {
  const { lockdownRefusal } = await import('./lockdown')
  const locked = await lockdownRefusal({
    request,
    org: context.org as LockdownVerdictOptions['org'],
    ...(context.uid ? { uid: context.uid } : {}),
    host: hostData,
  })
  return locked ? withResponseHeaders(locked, context.headers) : null
}

/**
 * For a site a request names OUTSIDE the `/v1/sites/{siteId}/…` path — a
 * `siteId` query parameter, a `consentSiteId` in a body — exactly what the
 * site router does for one named in the path (AGL-4235), built from the same
 * two helpers in the same order:
 *
 * 1. `hosts/{hostId}`, read once and fresh, because the lock is read off it.
 * 2. For a connected app, whether its person is on the site at all
 *    ({@link holdsSiteMembership}). Missing, or not a member, answers the
 *    router's `404 No such site`, so an app cannot learn a site exists by
 *    naming it — which is why this comes before the lock, whose 423 would.
 * 3. The site's own lock and takedown ({@link siteLockRefusal}), the request's
 *    method deciding: a read-only lock passes a GET and refuses a write.
 *
 * It does NOT ask whether the workspace owns the site. The caller keeps the
 * ownership check it already makes (`orgOwnsHost`, or what its resource does
 * in its place) and calls this after it, so a site of another workspace keeps
 * answering exactly what that resource answers today. The snapshot is handed
 * back so a handler that reads the site again uses this read.
 */
export async function admitNamedSite(
  context: ApiV1Context,
  request: Request,
  hostId: string,
): Promise<{ snapshot: FirebaseFirestore.DocumentSnapshot } | Response> {
  const snapshot = await context.firestore.collection('hosts').doc(hostId).get()
  if (!snapshot.exists || !holdsSiteMembership(context, snapshot)) {
    return ApiErrors.notFound({ message: 'No such site', headers: context.headers })
  }
  const locked = await siteLockRefusal(
    context,
    request,
    snapshot.data() as LockdownVerdictOptions['host'],
  )
  return locked ?? { snapshot }
}
