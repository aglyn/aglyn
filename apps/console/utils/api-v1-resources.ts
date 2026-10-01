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
 * Resource handlers for the customer REST API v1 (AGL-618). All data is
 * org-scoped from the authenticated key (see api-v1.ts). Sites, their form
 * submissions and the media library are the platform's resources. A resource
 * a plugin models — the data plugin's datasets and their records, the CRM's
 * contacts, deals and the rest — is served by that plugin, found through the
 * `/v1` resource registry (`dispatchResource`).
 */
import { mediaFilterKeys } from '@aglyn/aglyn/app-utils/media-metadata'
import {
  checkApiRequestQuota,
  checkDataStorageQuota,
  checkEntitlement,
  checkQuota,
  createResourceUid,
  defaultScopeForNewResource,
  getOrderFulfilmentService,
  inspectUploadBytes,
  isHostPluginEnabled,
  isBlockedSubdomain,
  readImageDimensions,
  type OrderFulfilmentTarget,
  screenRoutePathToUrl,
  SUBDOMAIN_PATTERN,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  apiJson,
  consumeRateLimit,
  decodeCursor,
  encodeCursor,
  firebaseAdmin,
  generateMediaVariants,
  getMediaQuarantine,
  listResponse,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import { runPluginEventHandlers } from '@aglyn/aglyn/plugin-manager/plugin-events'
import { runPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
// The registry's leaf: a resource a plugin serves is found here (AGL-3080).
import {
  apiV1Resource,
  apiV1Resources,
  describeApiV1Resources,
  readApiV1UsageFigures,
} from '@aglyn/tenant-data-admin/server/api-v1-resources'
import type { ApiV1ResourceDescription } from '@aglyn/tenant-data-admin/server/api-v1-description'
import { usageBand } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { createHash, randomUUID } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, apiUsageMonth, requireScope } from './api-v1'
import {
  claimWrite,
  orgOwnsHost,
  paginate,
  readJsonBody,
  serialize,
} from './api-v1/shared'
import {
  directUploadMaxBytes,
  isAllowedUploadType,
  isImageUploadType,
  isVideoUploadType,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  UPLOAD_TYPES_MESSAGE,
  VIDEO_UPLOADS_PAUSED_CODE,
  VIDEO_UPLOADS_PAUSED_MESSAGE,
} from './media-upload-limits'
import {
  isSvgUploadType,
  sanitizeSvgBuffer,
} from '@aglyn/aglyn/app-utils/sanitize-svg'
import { resolveOrgMediaBand } from './server/media-storage-band'
import { videoUploadsOpenForOrg } from './server/video-uploads'
import { scheduleMediaDeliveryCopies } from './server/media-delivery-copies'
import { folderStoragePath, mediaCdnPathUpdate } from './server/media-scope'
import { embeddedMetadataAtIngress } from './server/media-embedded'
import { mediaEmbeddedPublicView } from '@aglyn/aglyn/app-utils/media-embedded-fields'
import {
  claimHostForOrg,
  findSubdomainConflict,
} from './server/provision-host'
import { postTenantRevalidate } from './server/tenant-revalidate'
import { mediaStorageGate, scopeBillsStorageOverage } from './storage-overage'

// ── Sites & form submissions ────────────────────────────────────────────────

/**
 * The only fields a `site` resource is made of, and the projection every
 * host-document read behind it carries. Built from the same list the view
 * reads so a field cannot be added to one and forgotten in the other — a
 * projection missing a field renders it `null` rather than failing, which
 * is the kind of omission a test has to be looking for to catch.
 *
 * The host document is the largest in the product and most of it is theme
 * and routing data no API consumer asked for, so the list read below sends
 * bytes proportional to the page size only through these three names.
 */
const SITE_VIEW_FIELDS = ['displayName', 'subdomain', 'cname'] as const

function siteView(hostId: string, data: FirebaseFirestore.DocumentData | undefined) {
  return {
    id: hostId,
    object: 'site',
    displayName: data?.[SITE_VIEW_FIELDS[0]] ?? null,
    subdomain: data?.[SITE_VIEW_FIELDS[1]] ?? null,
    domain: data?.[SITE_VIEW_FIELDS[2]] ?? null,
  }
}

/**
 * The host documents behind one page of `/v1/sites`, in the order asked for.
 *
 * `Promise.all(ids.map((id) => …doc(id).get()))` is one BatchGetDocuments
 * per site — `DocumentReference.get()` is `getAll([ref])` — so a
 * `?limit=100` list was 100 round trips and 100 whole host documents for
 * three fields each. `getAll` is one round trip for the whole page.
 *
 * Snapshots are paired back by document id and the page is rebuilt in the
 * order it was ASKED for, rather than trusting the order they arrive in: a
 * batch that came back permuted would otherwise hand every site its
 * neighbour's name, and the cursor is the last id of this array.
 */
async function siteViews(
  firestore: FirebaseFirestore.Firestore,
  hostIds: string[],
) {
  // `getAll` requires at least one reference; an empty page is not an error.
  if (!hostIds.length) return []
  const snapshots = await firestore.getAll(
    ...hostIds.map((id) => firestore.collection('hosts').doc(id)),
    { fieldMask: [...SITE_VIEW_FIELDS] },
  )
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  return hostIds.map((id) => siteView(id, byId.get(id)?.data()))
}

/**
 * The per-ORG hourly ceiling on site creation over /v1 (AGL-2465).
 *
 * The console route already limits creates per uid and per IP (AGL-1968),
 * because `*.aglyn.app` is one global namespace and a subdomain someone squats
 * is gone for everybody. An API key has neither a uid nor a stable IP, so the
 * budget is keyed on the ORG — the thing a key actually belongs to, and the
 * thing the `hostLimit` quota is already counted against. Minting ten keys
 * therefore does not multiply the name-grab rate.
 *
 * Generous against real use and fatal to a sweep: an agency onboarding clients
 * does this once per client. The `hostLimit` quota below still bounds how many
 * sites an org may HOLD; this bounds how fast it may try.
 */
export const SITE_CREATE_LIMIT_PER_HOUR = 10
export const SITE_CREATE_WINDOW_MS = 60 * 60 * 1000

/**
 * `POST /v1/sites` — provision a site (AGL-2465).
 *
 * Ordering is scope, then validation, then claim, then budget, then work, and
 * every step of it is load-bearing:
 *
 * - **Scope and ownership first.** A refusal must never consume the budget,
 *   or an unauthorized caller can spend the org's own create allowance from
 *   outside it (AGL-2462's argument for `handlePublish`).
 * - **Deterministic 400s ABOVE the claim**, as `createRecord` and
 *   `createContact` argue: a broken payload must not take the key at all, so
 *   an integrator fixes the body and retries with the SAME key.
 * - **Conditional refusals BELOW it, each releasing the key** (AGL-2296). A
 *   taken subdomain clears when that site is renamed or deleted, and a quota
 *   refusal clears on upgrade — the retry that should finally succeed must
 *   not replay the refusal.
 *
 * The replay itself is what this endpoint exists for. `hosts/create` mints its
 * `hostId` with `createResourceUid()`, so a POST that succeeded server-side
 * but lost its response created a SECOND site on retry; the only thing
 * preventing it was accidental — the retry reused the same subdomain and 409'd
 * on uniqueness — and a client generating a subdomain per attempt lost even
 * that. Site creation is the most expensive object here to duplicate: a
 * `hostLimit` slot, a `hostIndex` write, and `syncOrgAuthProjections` across
 * every member of the org.
 *
 * `claim.record(200, view)` stores the response, so a replay returns the
 * ORIGINAL site — id included — from the stored body rather than a fresh read,
 * which is what makes it survive the site being renamed or deleted afterwards.
 * Stored as 200 while the fresh answer is 201, so a client can tell a replay
 * from a create.
 */
async function createSite(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const displayName = String((body as never)?.['displayName'] ?? '')
    .trim()
    .slice(0, 80)
  const subdomain = String((body as never)?.['subdomain'] ?? '')
    .trim()
    .toLowerCase()

  const fields: Record<string, string> = {}
  if (!displayName) fields['displayName'] = 'Required.'
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    fields['subdomain'] =
      'Must be 3-30 characters, lowercase letters, numbers and hyphens, and start with a letter or number.'
  } else if (isBlockedSubdomain(subdomain)) {
    fields['subdomain'] = 'That subdomain is reserved.'
  }
  if (Object.keys(fields).length > 0) {
    return ApiErrors.badRequest({
      message: 'Site failed validation',
      code: 'validation_failed',
      fields,
      headers: ctx.headers,
    })
  }

  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'sites',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const budget = await consumeRateLimit(`apiv1-site-create:${ctx.orgId}`, {
      limit: SITE_CREATE_LIMIT_PER_HOUR,
      windowMs: SITE_CREATE_WINDOW_MS,
    })
    if (!budget.allowed) {
      // Released: the budget refills, and the retry that should then succeed
      // must not replay a 429.
      await claim.release()
      return ApiErrors.rateLimited(
        Math.max(1, Math.ceil((budget.resetMs - Date.now()) / 1000)),
        ctx.headers,
      )
    }

    const conflict = await findSubdomainConflict(ctx.firestore, subdomain)
    if (conflict) {
      await claim.release()
      return ApiErrors.conflict({
        message: `That subdomain is taken. Available alternatives: ${conflict.suggestions.join(', ') || 'none'}`,
        code: 'subdomain_taken',
        headers: ctx.headers,
      })
    }

    const created = await claimHostForOrg({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      displayName,
      subdomain,
      org: ctx.org as never,
    })
    // Lost the subdomain to a concurrent create between the pre-check above
    // and the transaction's commit (AGL-2465). Same 409 the pre-check answers,
    // and the key is released for the same reason: the caller picks another
    // name and retries, and a burnt key would replay the refusal forever.
    // Suggestions are computed here rather than carried out of the transaction
    // — the winner's name is now genuinely taken, so the ordinary lookup is
    // correct and this path is rare enough that the extra reads do not matter.
    if (!created.allowed && created.conflict === true) {
      await claim.release()
      const raced = await findSubdomainConflict(ctx.firestore, subdomain)
      return ApiErrors.conflict({
        message: `That subdomain is taken. Available alternatives: ${raced?.suggestions.join(', ') || 'none'}`,
        code: 'subdomain_taken',
        headers: ctx.headers,
      })
    }
    if (!created.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message: `Site limit reached (${created.limit}). Upgrade the plan or add extra sites.`,
        code: 'site_quota',
        headers: ctx.headers,
      })
    }

    const view = siteView(created.hostId, {
      displayName,
      subdomain,
    } as never)
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

async function handleSites(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, sub] = segments

  if (!hostId) {
    // `sites:write` is checked BEFORE `sites:read`, matching
    // `handleScopedMedia` (AGL-900): a create-only key must not be told it
    // lacks the read scope it was never meant to hold.
    if (request.method === 'POST') {
      const deniedWrite = requireScope(ctx, 'sites:write')
      if (deniedWrite) return deniedWrite
      return createSite(request, ctx)
    }
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const hostIds = Object.keys((ctx.org.hosts ?? {}) as Record<string, unknown>).sort()
    const limit = parseLimit(url.searchParams.get('limit'))
    const cursor = decodeCursor(url.searchParams.get('cursor'))
    const start = cursor ? hostIds.findIndex((id) => id > cursor) : 0
    const page = hostIds.slice(start < 0 ? hostIds.length : start, (start < 0 ? hostIds.length : start) + limit)
    const nextCursor = start >= 0 && start + limit < hostIds.length ? encodeCursor(page[page.length - 1]) : null
    return listResponse(
      await siteViews(ctx.firestore, page),
      nextCursor,
      ctx.headers,
    )
  }


  if (!orgOwnsHost(ctx, hostId)) {
    return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  }

  if (!sub) {
    const denied = requireScope(ctx, 'sites:read')
    if (denied) return denied
    if (request.method !== 'GET') return ApiErrors.methodNotAllowed({ headers: ctx.headers })
    const [site] = await siteViews(ctx.firestore, [hostId])
    return apiJson(site, { headers: ctx.headers })
  }

  if (sub === 'form-submissions') {
    return handleFormSubmissions(request, ctx, segments, url)
  }

  if (sub === 'orders') return handleOrders(request, ctx, segments, url)
  if (sub === 'products') return handleProducts(request, ctx, segments, url)
  if (sub === 'media')
    return handleScopedMedia(request, ctx, url, hostRef(ctx, hostId), {
      collection: 'hosts',
      base: `hosts/${hostId}`,
      hostId,
      cdnScope: hostId,
    })
  if (sub === 'publish') return handlePublish(request, ctx, hostId)
  // Kept below the sub-resources so an unknown one still 404s here.

  return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
}

// ── Publish ─────────────────────────────────────────────────────────────────

/**
 * How many publishes one SITE may spend an hour (AGL-2462).
 *
 * The budget is per host and not per key because it bounds WORK, not requests.
 * One call sends up to `MAX_PATHS` = 250 paths to the tenant, each dropping a
 * cache entry whose next render costs roughly 40 Firestore reads — so the
 * cheapest call in the API is also the most expensive one, and the two limits
 * are not the same unit. Keyed on the API key instead, an organization mints
 * ten keys and multiplies the fan-out by ten; keyed on the host, the ceiling
 * is a property of the site being republished and no number of keys moves it.
 *
 * ## The number
 *
 * 10 an hour. A publish is a human-scale event even when a machine triggers
 * it: an integration that finishes a nightly catalogue sync publishes once,
 * and one that publishes after every record write does not want this endpoint
 * at all — it wants the hour-long cache window it already has, which is still
 * underneath as the backstop and is why a `429` here delays a change rather
 * than losing it. Ten leaves room for a bad afternoon of manual retries and still
 * caps the worst case at 2,500 dropped pages per site per hour, against the
 * ~1.2M reads a minute the documented 120/min per-key limit would have
 * allowed on its own.
 *
 * DURABLE (`consumeRateLimit`), not the per-instance counter: this is a limit
 * with a consequence on another service, and a ceiling that moves with how
 * many instances happen to be warm would not be one.
 */
export const PUBLISH_LIMIT_PER_HOUR = 10

/** Window for {@link PUBLISH_LIMIT_PER_HOUR}. */
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000

/**
 * `POST /v1/sites/{siteId}/publish` (AGL-2462) — the call that makes a write
 * visible.
 *
 * ## What was missing
 *
 * `POST /v1/datasets/{id}/records` wrote and called nothing else. What made a
 * live site show the new data was time, and only time: `getDatasets` is cached
 * for `DATASETS_TTL_SECONDS` (an hour) behind `tenantDataTag(hostId)`, and the
 * tenant catch-all page is `revalidate = 3600`. Time-based ISR is
 * stale-while-revalidate, so the visitor AFTER the window can still be served
 * the old copy and the change appears on the visit after that. An integration
 * could therefore own a site's data and never publish it — the cache expiring
 * is a side effect, not an operation the caller performed.
 *
 * ## The authorization, stated plainly
 *
 * The console path (`/api/screens/revalidate`) admits a user whose HOST role
 * `hostRoleCanWrite` accepts — every role the rules let write the site's
 * content — and 404s everyone else so a caller cannot learn a site exists. An
 * API key is an ORG credential with no uid, so there is no host role to read.
 * The same two questions are answered with the two facts a key does carry:
 *
 * 1. **May this credential publish at all?** `sites:publish`, which the
 *    organization's admin ticks when minting the key — a grant of its own,
 *    made once at mint time instead of per request, and never implied by a
 *    write scope (see its entry in `API_SCOPES` for why): a key without it
 *    cannot publish however much else it can read or write.
 * 2. **May it publish THIS site?** `orgOwnsHost`, the same predicate every
 *    other site sub-resource uses, and the analogue of passing `hostId` to
 *    `resolveOrgPermissions` so a scope over two sites cannot reach a third.
 *
 * The 404 posture is kept for the same reason the console route gives.
 *
 * ## Ordering
 *
 * Scope, then ownership, then the budget, then the work. The budget is spent
 * only by a caller who could actually have published, so a key without the
 * scope cannot burn a site's hourly allowance — a refusal that consumed the
 * budget would be a denial-of-service against the site's own operator, from
 * outside their organization's authorization.
 *
 * No `Idempotency-Key`: publishing twice lands the same state and returns the
 * same answer, exactly as `updateRecord` argues. The budget, not the key, is
 * what makes a retry loop safe.
 */
async function handlePublish(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'POST' },
    })
  }
  const denied = requireScope(ctx, 'sites:publish')
  if (denied) return denied

  const snap = await ctx.firestore.collection('hosts').doc(hostId).get()
  const subdomain = String(snap.get('subdomain') ?? '').trim()
  if (!snap.exists || !subdomain) {
    return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  }

  // Per-host hourly budget, ABOVE the fan-out and below the authorization.
  const rate = await consumeRateLimit(`apiv1-publish:${hostId}`, {
    limit: PUBLISH_LIMIT_PER_HOUR,
    windowMs: PUBLISH_WINDOW_MS,
  })
  if (!rate.allowed) {
    // The per-key `X-RateLimit-*` headers still ride along in `ctx.headers`;
    // they describe a different budget from the one that refused, so the
    // `Retry-After` is computed from THIS window and is the number to obey.
    return ApiErrors.rateLimited(
      Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)),
      ctx.headers,
    )
  }

  // `screens` is the routing map the console route reads for the same purpose:
  // screen id → route path. A site with none is not an error — an unrouted or
  // empty site has no live page to drop — but it must not report a publish it
  // did not perform, which is the "reported fast, still slow" confusion the
  // original bug was made of.
  const screens = (snap.get('screens') ?? {}) as Record<string, unknown>
  const paths = Object.values(screens)
    .filter((path) => typeof path === 'string')
    .map((path) => screenRoutePathToUrl(path as string))
  if (!paths.length) {
    return apiJson(
      {
        object: 'publish',
        site: hostId,
        published: false,
        reason: 'not_routed',
        pages: 0,
      },
      { headers: ctx.headers },
    )
  }

  const result = await postTenantRevalidate({
    subdomain,
    hostId,
    paths,
    // Same second cache key as the console's own publish route — a site on a
    // custom domain serves its pages under `cname--{domain}`.
    cname: String(snap.get('cname') ?? '') || undefined,
  })
  return apiJson(
    {
      object: 'publish',
      site: hostId,
      published: result.reason === 'ok',
      // Named rather than swallowed: `not-configured` and a tenant refusal are
      // the two cases where a caller would otherwise read a success and keep
      // polling a page that never changed.
      reason: result.reason === 'ok' ? null : result.reason,
      pages: result.revalidated.length,
      // The tenant's own 250-path cap (AGL-1161). A site above it is refreshed
      // in part, and the remainder catches up when its hour-long ISR window
      // lapses — worth saying, because the caller is the one deciding whether
      // to poll.
      pagesDropped: result.pathsDropped,
    },
    { headers: ctx.headers },
  )
}

// ── Form submissions ────────────────────────────────────────────────────────

function formSubmissionView(doc: FirebaseFirestore.DocumentSnapshot) {
  return {
    id: doc.id,
    object: 'form_submission',
    // The form ENTITY this was sent to, `null` for a row written before the
    // form was adopted. `form` below stays the caption — an integration
    // grouping by it is grouping by a display string that a rename splits,
    // which is the whole reason this field exists.
    form_id: doc.get('formId') ?? null,
    form: doc.get('formName') ?? null,
    path: doc.get('path') ?? null,
    fields: doc.get('fields') ?? {},
    read: Boolean(doc.get('read')),
    // Where the platform already sent this row. Omitting it meant an
    // integration syncing submissions into a CRM could not tell that a record
    // had already been written to a dataset — the one fact that stops it
    // duplicating work the platform had done.
    routing: doc.get('routing') ?? null,
    created: serialize(doc.get('createdAt')) ?? null,
  }
}

/**
 * `/v1/sites/{siteId}/form-submissions[/{submissionId}]` (AGL-2127).
 *
 * The list was the whole surface, and that shaped every integration written
 * against it badly. A lead sync polls, pushes new rows into a CRM, and then
 * has nowhere to record that it did — so it either re-pushes the same lead
 * next poll, or keeps its own high-water mark of ids against a list that
 * `conventions.md` publishes as ordered by DOCUMENT ID, not by time. The
 * `read` flag the console's inbox toggles on the very same document is the
 * state the integration needed and could not write.
 *
 * `read` is the ONLY writable field. A submission is what a visitor typed,
 * and an API that let an integration quietly rewrite it would make the
 * inbox's contents unattributable — so anything else in the body is a
 * `validation_failed` naming the offending key rather than a silent drop.
 */
async function handleFormSubmissions(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , submissionId] = segments
  const collection = ctx.firestore
    .collection('hosts')
    .doc(hostId)
    .collection('formSubmissions')

  if (!submissionId) {
    const denied = requireScope(ctx, 'forms:read')
    if (denied) return denied
    if (request.method !== 'GET') {
      return ApiErrors.methodNotAllowed({
        headers: { ...ctx.headers, Allow: 'GET' },
      })
    }
    // An EMPTY value means the filter is absent, matching `?email=` and
    // `?tag=` on contacts and `conventions.md`'s single rule for all three.
    // A client serializing an unset form field sends `?read=`, and refusing
    // that while `?email=` accepts it would be an inconsistency an integrator
    // discovers one filter at a time.
    const rawRead = url.searchParams.get('read') || null
    if (rawRead !== null && rawRead !== 'true' && rawRead !== 'false') {
      return ApiErrors.badRequest({
        message: 'Form submission filter failed validation',
        code: 'validation_failed',
        fields: { read: 'Must be true or false' },
        headers: ctx.headers,
      })
    }
    const read = rawRead === null ? null : rawRead === 'true'

    let query: FirebaseFirestore.Query = collection
    const form = url.searchParams.get('form')
    const formId = url.searchParams.get('formId')
    // `formId` is the id-first filter and wins when both are sent: it is the
    // one that survives a rename. `?form=` is NOT removed and is not
    // deprecated here — it filters on the caption every submission still
    // carries, which is the only thing a form that has not been adopted yet
    // can be filtered by. The same posture the legacy `?collection=` content
    // parameters take.
    if (formId) query = query.where('formId', '==', formId)
    else if (form) query = query.where('formName', '==', form)
    // `read` goes to FIRESTORE only when it is the sole filter, and is
    // applied after the read when it joins `form` (AGL-2460).
    //
    // Two equality clauses plus the `orderBy(FieldPath.documentId())` every
    // list here applies is a three-clause query, and Firestore serves that
    // only from a composite index. Shipping one to serve a filter
    // COMBINATION is a migration with a backfill, not a feature — and the
    // failure mode while it builds is this route's documented realistic 500
    // (see the route's `safeDispatch` docblock). Narrowing on `formName` and
    // dropping the rest in memory keeps the pre-existing `?form=` query
    // byte-for-byte what it already was, which is the property worth more
    // than one saved round trip.
    //
    // `read=false` IS exact against Firestore, unlike `?channel=online` on
    // orders. That filter is applied after the read because older orders
    // predate the `channel` field and a `where` would silently drop them.
    // The equivalent question was checked here rather than assumed: the
    // ONLY writer of this collection is the tenant's form-submit route, and
    // it has stamped `read: false` on every row since the feature's first
    // commit (AGL-76/77, `fc149e538`). There is no fieldless generation to
    // drop, so the cheap query is also the correct one.
    // Either form filter already spent this list's one equality clause, so
    // `read` is applied after the read exactly as it is for `?form=` — a
    // second `where` plus the document-id ordering is a three-clause query
    // and needs its own composite index per combination. The `formId ASC,
    // createdAt DESC` index this work ships serves the CONSOLE's ordered
    // list; `/v1` lists are ordered by document id and are a different query.
    const narrowedByForm = Boolean(formId || form)
    if (read !== null && !narrowedByForm) {
      query = query.where('read', '==', read)
    }
    const { docs, nextCursor } = await paginate(query, url)
    const matched =
      read !== null && narrowedByForm
        ? docs.filter((doc) => Boolean(doc.get('read')) === read)
        : docs
    return listResponse(matched.map(formSubmissionView), nextCursor, ctx.headers)
  }

  const submissionRef = collection.doc(submissionId)

  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'forms:read')
    if (denied) return denied
    const snap = await submissionRef.get()
    if (!snap.exists) {
      return ApiErrors.notFound({
        message: 'No such form submission',
        headers: ctx.headers,
      })
    }
    return apiJson(formSubmissionView(snap), { headers: ctx.headers })
  }

  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'forms:write')
    if (denied) return denied
    return updateFormSubmission(request, ctx, submissionRef)
  }

  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'forms:write')
    if (denied) return denied
    return deleteFormSubmission(request, ctx, hostId, submissionRef)
  }

  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}

/**
 * Mark one submission read or unread. No `Idempotency-Key`: the same body
 * twice lands the same state AND returns the same `200`, which is the test
 * `updateRecord` and `updateDataset` are held to.
 */
async function updateFormSubmission(
  request: Request,
  ctx: ApiV1Context,
  submissionRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const body = await readJsonBody(request)
  const unknown = Object.keys(body).filter((key) => key !== 'read')
  if (unknown.length > 0) {
    // Named, not dropped. `values` on a record drops unknown fields because a
    // dataset model defines what exists; a submission has no model, so a
    // silent drop here would read as "we stored your correction" when nothing
    // was stored, and the visitor's answers are exactly the thing that must
    // not be quietly editable.
    return ApiErrors.badRequest({
      message: 'Only `read` can be changed on a form submission',
      code: 'validation_failed',
      fields: Object.fromEntries(
        unknown.map((key) => [key, 'Not writable on a form submission']),
      ),
      headers: ctx.headers,
    })
  }
  if (typeof body.read !== 'boolean') {
    return ApiErrors.badRequest({
      message: 'Form submission failed validation',
      code: 'validation_failed',
      fields: { read: 'Must be true or false' },
      headers: ctx.headers,
    })
  }

  const snap = await submissionRef.get()
  if (!snap.exists) {
    return ApiErrors.notFound({
      message: 'No such form submission',
      headers: ctx.headers,
    })
  }
  await submissionRef.update({ read: body.read })
  return apiJson(formSubmissionView(await submissionRef.get()), {
    headers: ctx.headers,
  })
}

/**
 * Delete one submission. Accepts an `Idempotency-Key` for the reason
 * `deleteRecord` does: a purge that runs after an export is the operation
 * most likely to be retried on a timer, and without a key the retry cannot
 * tell "already gone" from "wrong id".
 */
async function deleteFormSubmission(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  submissionRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    hostId,
    request.headers.get('Idempotency-Key'),
    'form-submission-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const snap = await submissionRef.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({
        message: 'No such form submission',
        headers: ctx.headers,
      })
    }
    const removed = { id: snap.id, data: (snap.data() ?? {}) as Record<string, unknown> }
    await submissionRef.delete()
    /*
     * Whatever counted this row when it arrived (a form's counters, AGL-3330)
     * cannot see a delete, so the plugins are told what left. Best effort,
     * isolated per plugin by the seam: the delete is the request, and a
     * recount that fails leaves its figures for the next one rather than
     * failing a purge that already happened.
     */
    await runPluginEventHandlers('host.records.removed', {
      orgId: ctx.orgId,
      hostIds: [hostId],
      collection: 'formSubmissions',
      records: [removed],
    }).catch((error) => console.error('records-removed event after an API delete failed', error))
    const view = {
      id: submissionRef.id,
      object: 'form_submission',
      deleted: true,
    }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

// ── Commerce: orders & products (read) ──────────────────────────────────────

/**
 * Commerce resources need the `commerce` entitlement as well as the scope
 * (AGL-1928). `apiAccess` alone is the wrong gate here: it says the org may
 * call the API at all, not that it may still use the store. AGL-1873 closed
 * exactly this class on the write side — two money doors that asked the
 * plugin switch (`org.enabledPlugins`) instead of the plan, so a lapsed org
 * kept selling — and the same reasoning applies to a read. `enabledPlugins`
 * is the customer's own on/off switch and survives a downgrade; the plan does
 * not, and the published rule is that paid features stop at the door when the
 * plan no longer includes them.
 *
 * Answered as `plan_required` rather than `not_found`, deliberately. Hiding a
 * store that plainly exists behind a 404 sends an integrator hunting a wrong
 * site id; the honest answer names the plan.
 */
function requireCommerce(ctx: ApiV1Context): Response | null {
  return checkEntitlement(ctx.org, 'commerce')
    ? null
    : ApiErrors.planRequired({
        message: 'Commerce is not included in this organization’s plan',
        code: 'commerce',
        headers: ctx.headers,
      })
}

function hostRef(ctx: ApiV1Context, hostId: string) {
  return ctx.firestore.collection('hosts').doc(hostId)
}

/**
 * Orders carry a legacy Commerce Starter shape (AGL-90) alongside the modern
 * one: `amountCents`/`feeCents` at the top level rather than a `totals` map.
 * The console lifts them through `CommerceModel.liftLegacyOrder` and reads
 * `lifted.totals?.totalCents ?? order.amountCents`. The API cannot publish two
 * shapes for one object, so the legacy fields are folded into `totals` here
 * and a client only ever sees the modern one. `channel` defaults to `online`
 * for the same reason the console's list does — an absent channel is a
 * pre-channel order, not an unknown one.
 */
function orderView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const totals = (data.totals ?? {}) as Record<string, unknown>
  const legacyTotal = Number(data.amountCents ?? NaN)
  const totalCents = Number.isFinite(Number(totals.totalCents))
    ? Number(totals.totalCents)
    : Number.isFinite(legacyTotal)
      ? legacyTotal
      : null
  const legacyFee = Number(data.feeCents ?? NaN)
  return {
    id: doc.id,
    object: 'order',
    number: typeof data.number === 'number' ? data.number : null,
    status: (data.status as string) ?? null,
    channel: (data.channel as string) ?? 'online',
    currency: 'usd',
    customerEmail: data.customerEmail ?? null,
    customerName: data.customerName ?? null,
    lineItems: serialize(data.lineItems ?? []),
    totals: {
      itemsCents: Number(totals.itemsCents ?? 0),
      shippingCents: Number(totals.shippingCents ?? 0),
      taxCents: Number(totals.taxCents ?? 0),
      discountCents: Number(totals.discountCents ?? 0),
      totalCents,
      // The Connect application fee. NOT subtracted from `totalCents` — it is
      // Aglyn's cut of a total the shopper already paid in full, so a client
      // that nets it out of revenue would understate what it collected.
      feeCents: Number.isFinite(Number(totals.feeCents))
        ? Number(totals.feeCents)
        : Number.isFinite(legacyFee)
          ? legacyFee
          : 0,
    },
    // Money already handed back, for any reason. A chargeback lands here too,
    // so `refundedCents > 0` does not by itself mean the merchant chose it.
    refundedCents: Number(data.refundedCents ?? 0),
    disputed: Boolean(data.dispute),
    shippingAddress: serialize(data.shippingAddress) ?? null,
    couponCode: data.couponCode ?? null,
    // Shipment records — the half of fulfilment an integration can use
    // without a write (AGL-2460). `status` says an order is `fulfilled`; it
    // does not say which carrier took it or under what tracking number, so a
    // 3PL or accounting reconcile could see THAT an order shipped and never
    // WHICH shipment it was. The console's order dialog shows both, and an
    // order that has been shipped twice (a split shipment) is indistinguish-
    // able from one shipped once when only the status is published.
    //
    // `atMs` is a number of milliseconds, not a Firestore Timestamp, so
    // `serialize` passes it through untouched. It is republished as `at` in
    // ISO 8601 to match `created` and every other time this API emits: one
    // object publishing two time formats is a bug an integrator finds late,
    // in their own timezone conversion, and blames on their own code.
    fulfillments: (Array.isArray(data.fulfillments) ? data.fulfillments : []).map(
      (entry: Record<string, unknown>) => {
        const atMs = Number((entry ?? {}).atMs)
        return {
          id: (entry ?? {}).id ?? null,
          lineItemIds: Array.isArray((entry ?? {}).lineItemIds)
            ? (entry as { lineItemIds: unknown[] }).lineItemIds
            : [],
          carrier: (entry ?? {}).carrier ?? null,
          trackingNumber: (entry ?? {}).trackingNumber ?? null,
          trackingUrl: (entry ?? {}).trackingUrl ?? null,
          at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        }
      },
    ),
    created: serialize(data.createdAt) ?? null,
  }
}

async function handleOrders(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , orderId] = segments
  // `orders:write` is checked BEFORE `orders:read`, matching `handleSites`
  // and `handleScopedMedia` (AGL-900): a fulfilment key that only records
  // shipments must not be told it lacks a read scope it was never meant to
  // hold.
  if (request.method === 'PATCH' && orderId) {
    const deniedWrite = requireScope(ctx, 'orders:write')
    if (deniedWrite) return deniedWrite
    const unentitledWrite = requireCommerce(ctx)
    if (unentitledWrite) return unentitledWrite
    return updateOrder(request, ctx, hostId, orderId)
  }
  const denied = requireScope(ctx, 'orders:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: orderId ? 'GET, PATCH' : 'GET' },
    })
  }
  const collection = hostRef(ctx, hostId).collection('orders')

  if (orderId) {
    const snap = await collection.doc(orderId).get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such order', headers: ctx.headers })
    }
    return apiJson(orderView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const channel = url.searchParams.get('channel')
  // `online` is the DEFAULT, not a stored value on older orders, so filtering
  // for it in Firestore would silently drop every pre-channel order. Those are
  // exactly the oldest orders an accounting backfill is reaching for, so this
  // one value is filtered after the read instead. The page can therefore come
  // back shorter than `limit` while `has_more` is still true — which the
  // published pagination contract already tells clients to expect (check
  // `has_more`, never a page's length).
  if (channel && channel !== 'online') query = query.where('channel', '==', channel)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs
    .map(orderView)
    .filter((order) => (channel === 'online' ? order.channel === 'online' : true))
  return listResponse(data, nextCursor, ctx.headers)
}

/**
 * Statuses this endpoint will move an order TO, and the two it names as
 * refused. Kept as data so the 400 can list them and the docs can be checked
 * against the same source the handler branches on.
 */
const ORDER_WRITE_TARGETS: OrderFulfilmentTarget[] = ['fulfilled', 'delivered']

/**
 * Transitions that exist in the commerce model and are DELIBERATELY not
 * reachable here — refused by name with a 400 that says why, never silently
 * ignored. `cancelled` releases held stock under its own transaction and
 * `refunded` moves money under another; admitting either here would hand a
 * caller a door around exactly the specifics those two routes exist to
 * enforce, and an API key is the credential least able to answer the
 * questions they ask.
 */
const ORDER_WRITE_REFUSED: Record<string, string> = {
  cancelled:
    'Canceling an order releases held stock, so it is not part of this endpoint. Cancel it in the console.',
  refunded:
    'Refunding an order moves money, so it is not part of this endpoint. Refund it in the console.',
}

/**
 * `PATCH /v1/sites/{siteId}/orders/{orderId}` — record a shipment (AGL-2461).
 *
 * ## The write does not live here, and that is the point
 *
 * Not one line of order semantics is implemented in this file. The transition
 * rule, the transaction that re-asks it under the write, the fulfillment
 * append and the timeline entry all belong to the commerce plugin, which
 * `apps/console` may not import (`eslint.config.mjs`, `scope:app` →
 * `notDependOnLibsWithTags:['aglyn:addons']`). This handler reaches them
 * through the core `registerOrderFulfilmentService` capability registry, the
 * same app↔plugin shape as the billing-webhook hooks and site-page resolvers.
 *
 * A second copy of `ORDER_TRANSITIONS` inside `/v1` was the alternative, and
 * it is the bug rather than the fix: two tables drift, and drift here means
 * the API writing an order status the console forbids — `paid → delivered`
 * skipping fulfilment, or a write onto a `refunded` order. That is the class
 * AGL-1818/AGL-1819 exist to close, and it is money-adjacent.
 *
 * ## What THIS function is responsible for: all of the authorization
 *
 * The capability is pre-authorized by contract — it takes `hostId` on trust —
 * so every gate is here, and all four are load-bearing:
 *
 * 1. `orders:write` on the key (checked by the caller, above).
 * 2. The `commerce` PLAN entitlement (checked by the caller, above) — the
 *    plan, never the plugin switch, which is the AGL-1873 distinction.
 * 3. **Org owns the site** — `handleSites` refuses an unowned `hostId` with a
 *    404 before dispatching to any sub-resource, which is what keeps this
 *    from being a cross-tenant write primitive addressable by anyone who can
 *    guess a host id. Deliberately NOT re-checked here: a second copy would
 *    be a gate no test can redden (removing either one alone leaves the other
 *    answering), and an unproven guard on a cross-tenant write is worse than
 *    the one guard a test actually holds. `api-v1-order-fulfilment.spec.ts`'s
 *    "CANNOT move another org's order" case is that test, and it fails when
 *    `handleSites`' `orgOwnsHost` is removed.
 * 4. **The plugin is switched on for this site.** The registry is process-
 *    global and filled by `ensureAll`, so a registered service says nothing
 *    about one org's configuration; without this an org that switched
 *    commerce off for a site would still accept writes into it, which is the
 *    per-site enablement rule (AGL-1014) the plugin API dispatcher applies to
 *    every other commerce door.
 *
 * ## No `Idempotency-Key`
 *
 * None is needed and none is accepted: the capability returns without writing
 * when the order is already in the target status, so a retry lands the same
 * state AND returns the same `200` with the same order body — the contract
 * `updateRecord`, `updateContact` and `updateFormSubmission` are held to.
 */
async function updateOrder(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  orderId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  const unknown = Object.keys(body).filter(
    (key) => key !== 'status' && key !== 'carrier' && key !== 'trackingNumber',
  )
  if (unknown.length > 0) {
    // Named, not dropped — the `updateFormSubmission` / `updateContact` rule.
    // A silently ignored `trackingUrl` here reads as "we recorded your
    // shipment as you described it" when half of it went nowhere, and the
    // caller is a warehouse system that will never look again.
    return ApiErrors.badRequest({
      message:
        'Only `status`, `carrier` and `trackingNumber` can be set on an order',
      code: 'validation_failed',
      fields: Object.fromEntries(
        unknown.map((key) => [key, 'Not writable on an order']),
      ),
      headers: ctx.headers,
    })
  }

  const status = String(body.status ?? '')
  const refusal = ORDER_WRITE_REFUSED[status]
  if (refusal) {
    return ApiErrors.badRequest({
      message: refusal,
      code: 'validation_failed',
      fields: { status: refusal },
      headers: ctx.headers,
    })
  }
  if (!(ORDER_WRITE_TARGETS as string[]).includes(status)) {
    return ApiErrors.badRequest({
      message: 'Order failed validation',
      code: 'validation_failed',
      fields: {
        status: `Must be one of: ${ORDER_WRITE_TARGETS.join(', ')}`,
      },
      headers: ctx.headers,
    })
  }
  // Bounded exactly as the console route bounds them, so one field cannot be
  // used to stuff an order document through a door the console keeps narrow.
  const carrier = String(body.carrier ?? '').slice(0, 40)
  const trackingNumber = String(body.trackingNumber ?? '').slice(0, 60)

  // The plugin's server surface, activated the same way the plugin API
  // dispatcher activates it — one shared loader per process, so this costs
  // nothing after the first request.
  //
  // IMPORTED HERE, NOT AT MODULE SCOPE, and that is not a style choice.
  // `server-plugin-loader` builds the console's plugin manifest as a side
  // effect of being loaded, so a top-level import would run that for EVERY
  // /v1 request — a contacts read, a dataset write — to serve the one path
  // that needs it. It also drags the whole plugin manifest into the module
  // graph of every module that touches this file. Both are paid only by the
  // request that actually records a shipment this way. Node caches the
  // module, so the second call is a map lookup.
  const { serverPluginLoader } = await import('./server-plugin-loader')
  await serverPluginLoader.ensureAll(['consoleApi'])
  const service = getOrderFulfilmentService()
  if (!service) {
    // No loaded plugin provides order fulfilment — a build without commerce,
    // or a self-host that dropped it. The endpoint genuinely does not exist
    // in that deployment, and 404 is the honest answer rather than a 500.
    return ApiErrors.notFound({
      message: 'Order fulfilment is not available on this deployment',
      headers: ctx.headers,
    })
  }

  // Gate 4. `service.pluginId`, never a hard-coded `'commerce'` — the app
  // does not know the addon layer's names, and asking the capability which
  // plugin owns it is what keeps that true.
  const hostSnap = await hostRef(ctx, hostId).get()
  if (!isHostPluginEnabled(ctx.org, hostSnap.data(), service.pluginId)) {
    return ApiErrors.notFound({
      message: 'No such site',
      headers: ctx.headers,
    })
  }

  const outcome = await service.recordShipment({
    hostId,
    orderId,
    to: status as OrderFulfilmentTarget,
    carrier,
    trackingNumber,
  })
  if (outcome.outcome === 'no_such_order') {
    return ApiErrors.notFound({
      message: 'No such order',
      headers: ctx.headers,
    })
  }
  if (outcome.outcome === 'blocked') {
    // A NEW 409 code (`order_transition`), because an integrator has to be
    // able to tell "the order moved on without me" apart from every other
    // conflict this API can raise — it is the one a fulfilment poller will
    // actually hit, and the one it must not retry forever.
    return ApiErrors.conflict({
      message: `Orders in "${outcome.from}" cannot be marked ${status}`,
      code: 'order_transition',
      headers: ctx.headers,
    })
  }
  // The order object, on both `recorded` and `already` — a retry lands the
  // same state and reads the same 200. Re-read after the write so the body
  // shows the shipment that was just recorded rather than the one before it.
  return apiJson(orderView(await hostRef(ctx, hostId).collection('orders').doc(orderId).get()), {
    headers: ctx.headers,
  })
}

/**
 * Price and stock live on VARIANTS, never on the product — a product-level
 * `inventory` exists only as a denormalized sum the console rewrites on every
 * decrement, and a product-level `priceUsd` is the legacy single-variant
 * shape. Publishing either as the product's price would be wrong the moment a
 * product has two variants, so the variant array is the contract and the
 * product carries only the roll-up, clearly named.
 *
 * `inventory: null` on a variant means UNTRACKED and `0` means SOLD OUT.
 * Collapsing them (the `?? 0` an integrator writes on the first day) turns
 * every untracked product into an out-of-stock one, so the distinction is
 * carried through verbatim rather than defaulted.
 */
function variantView(variant: Record<string, unknown>) {
  const inventory = variant.inventory
  return {
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    options: variant.options ?? {},
    priceUsd: typeof variant.priceUsd === 'number' ? variant.priceUsd : null,
    compareAtPriceUsd:
      typeof variant.compareAtPriceUsd === 'number'
        ? variant.compareAtPriceUsd
        : null,
    weightGrams:
      typeof variant.weightGrams === 'number' ? variant.weightGrams : null,
    inventory: typeof inventory === 'number' ? inventory : null,
    inventoryTracked: typeof inventory === 'number',
  }
}

function productView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const variants = Array.isArray(data.variants)
    ? (data.variants as Array<Record<string, unknown>>)
    : []
  const tracked = variants.filter((v) => typeof v.inventory === 'number')
  return {
    id: doc.id,
    object: 'product',
    name: data.name ?? null,
    slug: data.slug ?? null,
    description: data.description ?? null,
    type: data.type ?? null,
    status: data.status ?? null,
    tags: data.tags ?? [],
    categoryIds: data.categoryIds ?? [],
    mediaUrls: data.mediaUrls ?? [],
    options: data.options ?? [],
    variants: variants.map(variantView),
    // The sum across TRACKED variants only, and `null` when none of them is
    // tracked — so an untracked catalogue reads as "we don't count this"
    // rather than as a store with nothing left to sell.
    inventory: tracked.length
      ? tracked.reduce((sum, v) => sum + Number(v.inventory ?? 0), 0)
      : null,
    subscription: serialize(data.subscription) ?? null,
    created: data.createdAtMs ? new Date(Number(data.createdAtMs)).toISOString() : null,
    updated: data.updatedAtMs ? new Date(Number(data.updatedAtMs)).toISOString() : null,
  }
}

async function handleProducts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, hostId, , productId] = segments
  const denied = requireScope(ctx, 'products:read')
  if (denied) return denied
  const unentitled = requireCommerce(ctx)
  if (unentitled) return unentitled
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: ctx.headers })
  }
  const collection = hostRef(ctx, hostId).collection('products')

  if (productId) {
    const snap = await collection.doc(productId).get()
    // A soft-deleted product is gone as far as a customer is concerned. The
    // console filters `deletedAt` client-side; the API must not hand back a
    // product the merchant deleted just because the document survives.
    if (!snap.exists || snap.get('deletedAt')) {
      return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
    }
    return apiJson(productView(snap), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const status = url.searchParams.get('status')
  if (status) query = query.where('status', '==', status)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs.filter((doc) => !doc.get('deletedAt')).map(productView)
  return listResponse(data, nextCursor, ctx.headers)
}

// ── Media (read) ────────────────────────────────────────────────────────────

/**
 * Media is stored under BOTH scopes — `orgs/{orgId}/media` is the shared
 * organization library and `hosts/{hostId}/media` is one site's own files —
 * so the API publishes it at both `/v1/media` and `/v1/sites/{id}/media`
 * rather than picking one and lying about the other.
 *
 * `url` is the durable download URL and is always present. `cdnUrl` is the
 * CDN path, which exists only when the plan includes `mediaCdn` AND the asset
 * is not private, so it is published as a separate nullable field rather than
 * folded into `url` — an integrator building a public `<img>` needs to know
 * which one it got. Private assets carry neither a CDN path nor a usable
 * public link and are marked `private: true`.
 */
function mediaView(doc: FirebaseFirestore.DocumentSnapshot, origin: string) {
  const data = doc.data() ?? {}
  const cdnPath = data.cdnPath as string | undefined
  return {
    id: doc.id,
    object: 'media',
    fileName: data.fileName ?? null,
    contentType: data.contentType ?? null,
    sizeBytes: Number(data.sizeBytes ?? 0),
    width: typeof data.width === 'number' ? data.width : null,
    height: typeof data.height === 'number' ? data.height : null,
    alt: data.alt ?? null,
    description: data.description ?? null,
    tags: data.tags ?? [],
    folderId: data.folderId ?? null,
    url: data.url ?? null,
    cdnUrl: cdnPath ? `${origin}${cdnPath}` : null,
    private: Boolean(data.private),
    // The name → value fields set in the library's Details drawer (AGL-822).
    customMetadata: publishedCustomMetadata(data.customMetadata),
    // What the file carries inside itself — title, caption, keywords,
    // creator, location, camera (AGL-3339). `null` until the file has been
    // read, and never the details of bytes this asset no longer holds.
    embeddedMetadata: mediaEmbeddedPublicView(
      data.embeddedMetadata,
      data.contentSha256,
    ),
    created: serialize(data.createdAt) ?? null,
  }
}

/** Only string values: the map is typed, and a stray write must not leak. */
function publishedCustomMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/**
 * Which media library a write lands in. Mirrors the fields of `MediaScope`
 * that a create actually needs — `resolveMediaScope` itself cannot be reused
 * here because it resolves a console USER's membership from a uid, and an API
 * key has none (the scope check and `orgOwnsHost` answer that question
 * instead).
 */
interface MediaWriteScope {
  collection: 'orgs' | 'hosts'
  /** Storage prefix: `orgs/{orgId}` or `hosts/{hostId}`. */
  base: string
  hostId: string | null
  /** `{hostId}` or `org:{orgId}` — the CDN route's scope segment. */
  cdnScope: string
}

/**
 * `POST /v1/media` and `POST /v1/sites/{siteId}/media` (AGL-2463).
 *
 * ## The wire format, and why it is not multipart
 *
 * A JSON body with base64 `data`, which is the SAME shape the console's own
 * direct upload route takes — not a new contract invented for the API. It
 * keeps `/v1` to one envelope, and it makes `Idempotency-Key` mean what
 * `conventions.md` publishes: one call, one create, retriable. The signed-URL
 * handshake was the alternative and is worse here on both counts — creation
 * becomes a two-call, three-party operation whose middle leg is not ours, so
 * an idempotency key has no coherent meaning across it.
 *
 * It is also the SAFER of the two, which decided it. The signed route hands
 * the client a URL and never sees the bytes, so it can only record the size
 * the caller declared and a digest derived from GCS's md5 (AGL-1629). Bytes
 * through this path are measured, sanitized and hashed by us:
 *
 * - **Content type**: `isAllowedUploadType`, the same allowlist the console
 *   uses. Refused with `415`.
 * - **Size**: `directUploadMaxBytes` for the type, measured on the DECODED
 *   bytes rather than on a declared `sizeBytes` a caller controls. `413`.
 * - **SVG**: `sanitizeSvgBuffer`, so a stored SVG cannot carry script.
 * - **Digest**: a full sha256 over the received bytes, which is what makes
 *   the takedown check below able to match. `451` when it does.
 * - **Quota**: `mediaStorageGate`, below.
 *
 * ## What this does NOT do, stated plainly
 *
 * There is **no malware or content scanning** at this chokepoint, because
 * there is none at any of the console's four either (AGL-1475) — this
 * endpoint inherits that gap rather than introducing it, and an operator
 * should not read the allowlist as though it were a scanner. There is also
 * **no magic-byte sniffing** anywhere in media ingress: the declared content
 * type is trusted, corrected only by file extension. So `isAllowedUploadType`
 * bounds what a file CLAIMS to be, not what it is, and a caller with a valid
 * key can store arbitrary bytes under an allowed type. The residual risk is
 * bounded by the same things that bound it for the console: uploads land in
 * the customer's own library, and serving is `Content-Type`-pinned. The docs
 * say this in the same words rather than repeating the "virus scanning" claim
 * that was there before and was never true.
 *
 * ## The money
 *
 * `mediaStorageGate`, through `resolveOrgMediaBand` and
 * `scopeBillsStorageOverage` — the SAME three helpers the console's ingress
 * routes call, never a second copy. Storage is already a charged dimension
 * (per-GB overage), so this consumes the existing meter and invents nothing.
 * A second implementation of the band is exactly the drift that keeps
 * `checkContactQuota` shared between capture and `POST /v1/contacts`.
 *
 * ## Ordering
 *
 * Deterministic refusals (415/413/400) sit ABOVE the idempotency claim, so a
 * broken payload never takes the key and the integrator can fix it and retry
 * with the same one. Everything conditional sits below and RELEASES the claim
 * on refusal — `createContact`'s rule, and the reason a create that exactly
 * fills the band stays retriable instead of replaying a `403` forever.
 */
async function createMedia(
  request: Request,
  ctx: ApiV1Context,
  scopeRef: FirebaseFirestore.DocumentReference,
  scope: MediaWriteScope,
  origin: string,
): Promise<Response> {
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const fileName = String(body.fileName ?? 'upload').slice(0, 200)
  const declaredType = String(body.contentType ?? '')
  const contentType = normalizeUploadContentType(declaredType, fileName)

  if (!isAllowedUploadType(contentType)) {
    return ApiErrors.unsupportedMediaType({
      message: UPLOAD_TYPES_MESSAGE,
      code: 'unsupported_media_type',
      headers: ctx.headers,
    })
  }

  // Video ingress is behind a release flag (AGL-2830). Above the idempotency
  // claim with the other refusals about the file itself, so a key sent with a
  // refused video is still unused when the flag opens, and before the body is
  // decoded, so a refused video costs no inspection or digest.
  if (
    isVideoUploadType(contentType) &&
    !(await videoUploadsOpenForOrg(ctx.orgId))
  ) {
    return ApiErrors.forbidden({
      message: VIDEO_UPLOADS_PAUSED_MESSAGE,
      code: VIDEO_UPLOADS_PAUSED_CODE,
      headers: ctx.headers,
    })
  }

  // Strict base64. `Buffer.from(x, 'base64')` is famously permissive — it
  // silently drops anything it cannot decode — so a typo'd payload would
  // otherwise be stored as a short, corrupt file that reports success.
  const raw = String(body.data ?? '')
  const decoded = Buffer.from(raw, 'base64')
  if (!raw || !decoded.length || decoded.toString('base64').replace(/=+$/, '') !== raw.replace(/\s/g, '').replace(/=+$/, '')) {
    return ApiErrors.badRequest({
      message: '`data` must be the file\'s bytes, base64-encoded',
      code: 'validation_failed',
      fields: { data: 'not valid base64' },
      headers: ctx.headers,
    })
  }

  const maxBytes = Number(directUploadMaxBytes(contentType) ?? 0)
  if (!maxBytes || decoded.length > maxBytes) {
    return ApiErrors.payloadTooLarge({
      message: `File is too large (${Math.round(maxBytes / 1024 / 1024)}MB max for ${contentType})`,
      code: 'file_too_large',
      headers: ctx.headers,
    })
  }

  /**
   * STRUCTURAL inspection (AGL-1475). AGL-2463 shipped this route with the
   * gap written down — "no magic-byte sniffing anywhere in media ingress, the
   * declared type is trusted" — and this is that sentence being retired.
   *
   * It matters more here than on the console routes, not less. This is the
   * key-authenticated path: the caller is a migration tool or an agency's
   * automation, not a person watching a progress bar, and `media:write` was
   * added precisely so a key could fill a library unattended. A key that
   * leaks fills it unattended too.
   *
   * Structure only — not an antivirus scan. See `upload-inspection.ts` for
   * the exact boundary, and do not let it drift back into a scanning claim.
   */
  {
    const refusal = inspectUploadBytes({
      bytes: decoded,
      contentType,
      fileName,
    })
    if (refusal) {
      return ApiErrors.unsupportedMediaType({
        message: refusal.message,
        code: refusal.code,
        headers: ctx.headers,
      })
    }
  }

  // Sanitize BEFORE hashing and before measuring what we store, so the digest
  // and the counter both describe the bytes that actually landed.
  const svg = isSvgUploadType(contentType) ? sanitizeSvgBuffer(decoded) : null
  const buffer = svg ? svg.buffer : decoded
  const contentSha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
  const contentHash = contentSha256.slice(0, 16)

  const claimed = await claimWrite(
    ctx,
    scope.collection === 'hosts' ? (scope.hostId ?? '*') : '*',
    request.headers.get('Idempotency-Key'),
    'media',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    // The takedown ledger, matched on the digest we just computed.
    const quarantine = await getMediaQuarantine({ contentSha256, contentHash })
    if (quarantine) {
      await claim.release()
      return ApiErrors.unavailableForLegalReasons({
        code: 'media_quarantined',
        headers: ctx.headers,
      })
    }

    // Video and document uploads are a paid capability; images are not.
    if (
      requiresFileUploadEntitlement(contentType) &&
      !checkEntitlement(ctx.org, 'videoMedia')
    ) {
      await claim.release()
      return ApiErrors.planRequired({
        message: 'Video and file uploads require a Pro plan',
        code: 'media_type_plan',
        headers: ctx.headers,
      })
    }

    const band = await resolveOrgMediaBand({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      org: ctx.org as never,
      currentHostId: scope.collection === 'hosts' ? scope.hostId : null,
    })
    const gate = mediaStorageGate({
      org: ctx.org as never,
      // Includes the incoming file, and keeps the caller's `Math.ceil(x) - 1`
      // convention (AGL-471) by handing the helper the same input the console
      // does rather than a second rounding rule.
      usedMb: (band.usedBytes + buffer.length) / (1024 * 1024),
      allowanceMb: band.allowanceMb,
      billsOverage: scopeBillsStorageOverage(scope.collection),
    })
    if (!gate.allowed) {
      await claim.release()
      return ApiErrors.planRequired({
        message: gate.error ?? `Storage limit reached (${gate.limitMb} MB)`,
        code: 'storage_quota',
        headers: ctx.headers,
      })
    }

    const mediaId = createResourceUid()
    const token = randomUUID()
    const folderId = body.folderId ? String(body.folderId).slice(0, 64) : null
    const folderPath = await folderStoragePath(scopeRef, folderId)
    // Built the same way the console's upload route builds it: the object
    // lives INSIDE its folder's Storage prefix, so the bucket tree mirrors the
    // library tree. (`mediaObjectPath` is the read-side helper — it derives a
    // path from an EXISTING media document, which a create does not have.)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    await bucket.file(objectPath).save(buffer, {
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}?alt=media&token=${token}`

    const dimensions = isImageUploadType(contentType)
      ? (readImageDimensions(new Uint8Array(buffer)) ?? {})
      : {}
    const isPrivate = body.private === true
    const cdnAllowed = checkEntitlement(ctx.org, 'mediaCdn') && !isPrivate
    const variants = cdnAllowed
      ? await generateMediaVariants({
          buffer,
          contentType,
          sourceWidth: (dimensions as { width?: number }).width,
          objectPath,
          saveVariant: async (path: string, webp: Buffer) => {
            await bucket.file(path).save(webp, { contentType: 'image/webp' })
          },
        }).catch(() => null)
      : null
    // What the file carries inside itself (AGL-3339), read the way the
    // console's upload routes read it: time-boxed, and never a refusal.
    const embeddedMetadata = await embeddedMetadataAtIngress({
      contentType,
      bytes: new Uint8Array(buffer),
      contentSha256,
    })

    await scopeRef.collection('media').doc(mediaId).create({
      fileName,
      contentType,
      sizeBytes: buffer.length,
      url: downloadUrl,
      storagePath: objectPath,
      folderId,
      ...dimensions,
      ...(body.alt ? { alt: String(body.alt).slice(0, 500) } : {}),
      // What the console library filters and searches by (AGL-3327).
      ...mediaFilterKeys({
        fileName,
        contentType,
        alt: body.alt ? String(body.alt).slice(0, 500) : '',
        ...dimensions,
        // The details read at ingress join the search (AGL-3339).
        embeddedMetadata,
        contentSha256,
      }),
      contentHash,
      contentSha256,
      variants: (variants as { variants?: number[] })?.variants ?? [],
      ...(embeddedMetadata ? { embeddedMetadata } : {}),
      ...(svg?.removed?.length ? { svgSanitized: svg.removed } : {}),
      // The org library is shared across sites, so a file written there needs
      // a scope token or it matches no scoped read (AGL-1044).
      ...(scope.collection === 'orgs'
        ? { visibleTo: defaultScopeForNewResource({ hostId: null }) }
        : {}),
      // Stable, mediaId-keyed CDN URL (AGL-829). The helper applies the
      // plan-and-private rule itself, so this is the same expression the
      // console's three ingress routes write and cannot disagree with them.
      cdnPath: mediaCdnPathUpdate({
        billing: ctx.org as never,
        cdnScope: scope.cdnScope,
        mediaId,
        isPrivate,
      }),
      ...(isPrivate ? { private: true } : {}),
      // `sources.api`, beside the console's own uploads, so a merchant can see
      // which files an integration put there.
      uploadedBy: `api:${ctx.keyId}`,
      createdAt: Timestamp.now(),
    })

    // The billed counter, LAST and by increment — the same write and the same
    // exclusion of generated variant bytes the console ingress routes make, so
    // ingress and `report-usage` keep describing one number.
    await scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
          count: firebaseAdmin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      )
    // A video goes to the delivery provider after the response, like one
    // uploaded in the console (AGL-2824). Nothing runs without a provider.
    scheduleMediaDeliveryCopies({
      scope: {
        collection: scope.collection,
        scopeId: scopeRef.id,
        orgId: ctx.orgId,
        scopeRef,
      },
      mediaId,
      contentType,
    })

    const view = mediaView(await scopeRef.collection('media').doc(mediaId).get(), origin)
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

async function handleScopedMedia(
  request: Request,
  ctx: ApiV1Context,
  url: URL,
  scopeRef: FirebaseFirestore.DocumentReference,
  scope: MediaWriteScope,
): Promise<Response> {
  const origin = url.origin
  const segmentsAll = url.pathname.split('/').filter(Boolean)

  // POST is a create on the COLLECTION only — never on `/media/{id}`, which
  // would read as a replace. Checked before the read scope so a write-only key
  // is not told it is missing `media:read` (AGL-900).
  if (request.method === 'POST') {
    if (segmentsAll[segmentsAll.length - 1] !== 'media') {
      return ApiErrors.methodNotAllowed({
        headers: { ...ctx.headers, Allow: 'GET' },
      })
    }
    const deniedWrite = requireScope(ctx, 'media:write')
    if (deniedWrite) return deniedWrite
    return createMedia(request, ctx, scopeRef, scope, origin)
  }

  const denied = requireScope(ctx, 'media:read')
  if (denied) return denied
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }
  const collection = scopeRef.collection('media')
  // The trailing segment is the media id only on the `/media/{id}` shape.
  const mediaId =
    segmentsAll[segmentsAll.length - 2] === 'media'
      ? segmentsAll[segmentsAll.length - 1]
      : ''

  if (mediaId) {
    const snap = await collection.doc(mediaId).get()
    // `deletedAt` is the soft-delete marker every console read gates on.
    if (!snap.exists || snap.get('deletedAt')) {
      return ApiErrors.notFound({ message: 'No such file', headers: ctx.headers })
    }
    return apiJson(mediaView(snap, origin), { headers: ctx.headers })
  }

  let query: FirebaseFirestore.Query = collection
  const folder = url.searchParams.get('folder')
  if (folder) query = query.where('folderId', '==', folder)
  const { docs, nextCursor } = await paginate(query, url)
  const data = docs
    .filter((doc) => !doc.get('deletedAt'))
    .map((doc) => mediaView(doc, origin))
  return listResponse(data, nextCursor, ctx.headers)
}

// ── Usage (read) ────────────────────────────────────────────────────────────

/**
 * `GET /v1/usage` (AGL-2277) — the caller's own meter, for the current
 * billing month.
 *
 * `/v1` is the metered surface: an integration is the thing generating
 * `apiRequestsPerMonth`, and until this shipped it had no way to ask how much
 * of the band it had spent. The only signal was the `429` at the end of the
 * month with a `Retry-After` pointing at the month boundary — a wall with no
 * approach — and no way at all to check whether a bulk import was about to
 * cross an audience or storage band.
 *
 * NO SCOPE, like `GET /v1/me`. An API key is an organization credential and
 * this is that organization's own meter; requiring, say, `datasets:read`
 * would mean a key scoped to contacts could not see the quota that refuses
 * it. It is metered as one request like everything else, which is why the
 * number it reports may be one behind — see the note on `apiRequests`.
 *
 * `apiRequests` is read from `orgs/{orgId}/apiUsage/{month}` — the LIVE
 * counter `refuseIfApiQuotaExhausted` enforces from, not the swept monthly
 * rollup, so what this reports and what refuses a request are the same
 * number. `dataStorageMb` is the opposite case by necessity: bytes are
 * measured by the `report-usage` sweep, so the honest field to publish is the
 * swept one that billing actually prices from, and its staleness is
 * documented rather than hidden behind a fresh but differently-derived
 * figure.
 */
export async function handleUsage(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET' },
    })
  }
  const orgRef = ctx.firestore.collection('orgs').doc(ctx.orgId)
  const month = apiUsageMonth()
  const [apiSnap, storageSnap, campaignEmailSnap, pluginFigures] =
    await Promise.all([
      orgRef.collection('apiUsage').doc(month).get(),
      orgRef.collection('usage').doc(month).get(),
      // The ORG counter, which is what `reserveCampaignEmailSends` claims
      // against. The per-site counter beside it is site history and answers a
      // different question; reporting it here would disagree with the gate.
      orgRef.collection('counters').doc('campaignEmailSends').get(),
      // What the plugins add (AGL-3080) — a band their records are metered
      // on (the data plugin's datasets, the CRM's records), the sizes of
      // their collections — each read by its plugin.
      ensurePluginDeclarations().then(() =>
        readApiV1UsageFigures(ctx, PLATFORM_USAGE_FIGURES),
      ),
    ])

  const apiQuota = checkApiRequestQuota(
    ctx.org as never,
    Number(apiSnap.get('count') ?? 0),
  )
  const storageQuota = checkDataStorageQuota(
    ctx.org as never,
    Number(storageSnap.get('dataStorageMb') ?? 0),
  )
  // A corrupt or negative counter must not read as headroom, the same clamp
  // `orgCampaignEmailSendsForMonth` applies on the server.
  const rawCampaignEmails = Number(campaignEmailSnap.get(month) ?? 0)
  const campaignEmailsUsed =
    Number.isFinite(rawCampaignEmails) && rawCampaignEmails > 0
      ? Math.floor(rawCampaignEmails)
      : 0
  const campaignEmailQuota = checkQuota(
    ctx.org as never,
    'emailSendsPerMonth',
    campaignEmailsUsed,
  )

  return apiJson(
    {
      object: 'usage',
      month,
      apiRequests: usageBand(
        apiQuota.used,
        apiQuota.included,
        apiQuota.remaining,
        apiQuota.overageRateUsd,
      ),
      dataStorageMb: usageBand(
        storageQuota.usedMb,
        storageQuota.includedMb,
        storageQuota.remainingMb,
        storageQuota.overageRateUsd,
      ),
      /*
       * CAMPAIGN emails, not every email. `emailSendsPerMonth` governs
       * campaign volume alone — transactional mail is counted for cost and
       * never refused at any tier — so a band named `emails` would report a
       * limit the product does not enforce.
       *
       * `metered: false`, because this band is REFUSED rather than billed.
       * It is the one dimension here that hard-walls on a paid plan; the
       * others accept the excess and put it on the invoice. Passing a null
       * rate is how that difference reaches a caller rather than being
       * something they discover from a 403.
       */
      campaignEmails: usageBand(
        campaignEmailsUsed,
        campaignEmailQuota.limit,
        campaignEmailQuota.remaining,
        null,
      ),
      ...pluginFigures,
    },
    { headers: ctx.headers },
  )
}

/** The members of `GET /v1/usage` the platform answers, which no plugin may take. */
const PLATFORM_USAGE_FIGURES: ReadonlySet<string> = new Set([
  'object',
  'month',
  'apiRequests',
  'dataStorageMb',
  'campaignEmails',
])

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Runs the app's declarations step when no plugin has registered a `/v1`
 * resource — a process whose boot failed — so what the plugins serve,
 * describe and report is registered before it is read. The step memoizes
 * itself, so this is one attempt per process.
 */
async function ensurePluginDeclarations(): Promise<void> {
  if (apiV1Resources().length > 0) return
  await runPluginDeclarationsRepair().catch(() => false)
}

/** The top-level resources the plugins serve here, in registration order. */
export async function pluginApiV1ResourceNames(): Promise<string[]> {
  await ensurePluginDeclarations()
  return apiV1Resources().map(({ name }) => name)
}

/**
 * How the plugins describe the resources they serve, for the OpenAPI
 * document and the MCP tools derived from it.
 */
export async function describePluginApiV1Resources(): Promise<ApiV1ResourceDescription[]> {
  await ensurePluginDeclarations()
  return describeApiV1Resources()
}

/**
 * The resource a plugin serves under `/v1/<name>` (AGL-3080), or `null`.
 *
 * Registered at the console's boot from the plugin's console server
 * declarations; a name no registration answers is asked once more after
 * running the app's declarations step, so a process whose boot failed
 * repairs itself rather than answering `404` for a resource it serves.
 */
async function pluginResource(name: string) {
  const found = apiV1Resource(name)
  if (found) return found
  if (!(await runPluginDeclarationsRepair().catch(() => false))) return null
  return apiV1Resource(name)
}

/** Route a `/v1/<resource>/...` request to its handler. */
export async function dispatchResource(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
): Promise<Response> {
  const url = new URL(request.url)
  switch (segments[0]) {
    case 'sites':
      return handleSites(request, ctx, segments, url)
    case 'media':
      // The ORGANIZATION library. A site's own files are the same resource
      // under `/v1/sites/{siteId}/media`.
      return handleScopedMedia(
        request,
        ctx,
        url,
        ctx.firestore.collection('orgs').doc(ctx.orgId),
        {
          collection: 'orgs',
          base: `orgs/${ctx.orgId}`,
          hostId: null,
          cdnScope: `org:${ctx.orgId}`,
        },
      )
  }
  /*
   * A resource a plugin models is the plugin's (AGL-3080): it registered a
   * handler under the name, and the plan feature the resource needs. The
   * plan question comes before the scope one and before the handler, here
   * rather than inside each: a scope is mintable on a key whose org was
   * later moved to a plan without the feature by a staff override, and a
   * scope that still answered would be the shell's "extensions cannot bypass
   * entitlements" promise broken over the wire. Same shape as the
   * `dataStore` refusal on datasets.
   */
  const plugin = segments[0] ? await pluginResource(segments[0]) : null
  if (plugin) {
    const { entitlement } = plugin.resource
    if (entitlement && !checkEntitlement(ctx.org, entitlement.feature)) {
      return ApiErrors.planRequired({
        message: entitlement.message,
        code: entitlement.feature,
        headers: ctx.headers,
      })
    }
    return plugin.resource.handle(request, ctx, segments, url)
  }
  return ApiErrors.notFound({
    message: `Unknown endpoint: /v1/${segments.join('/')}`,
    headers: ctx.headers,
  })
}
