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
 * The helpers every `/v1` resource handler shares (AGL-2606).
 *
 * These lived at the top of `api-v1-resources.ts` while that file held every
 * resource. The CRM resources are the first to live in modules of their own,
 * and a second copy of the cursor grammar or the idempotency claim in each of
 * them is exactly the drift the originals were written to prevent: a cursor
 * one resource encodes and another cannot decode, or a claim digest that
 * collides across resources because one copy forgot the org. So the originals
 * moved here, unchanged in behavior, and both files import them.
 */
import { type AttemptClaim, claimAttempt } from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import type { ApiV1Context } from '../api-v1'

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

// ── Ownership ───────────────────────────────────────────────────────────────

/** Whether `hostId` is one of the authenticated organization's own sites. */
export function orgOwnsHost(ctx: ApiV1Context, hostId: string): boolean {
  const hosts = (ctx.org.hosts ?? {}) as Record<string, unknown>
  return Boolean(hosts[hostId])
}
