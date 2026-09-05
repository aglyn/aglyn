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
 * What the CRM resources of `/v1` have in common (AGL-2606).
 *
 * Companies, pipelines, deals, tasks and activities are five collections
 * with one shape (`CrmScoped`), one scope model (`crmScopeTokens`) and one
 * set of questions every write has to answer — which site is this for, is
 * that uid a member here, does the contact it names exist. Each handler
 * module answers those through this file, so the answer cannot differ by
 * resource.
 *
 * ## Reads are org-wide, writes name a site
 *
 * An API key is an ORGANIZATION credential (`api-keys.ts`), so a list here
 * reads the whole collection: every company the org's sites know, whichever
 * site created it. That is the same answer `GET /v1/contacts` gives, and it
 * is right for the caller the key represents — an integration acting for the
 * account, not a member sitting on one site.
 *
 * A write is different, because a CRM record carries `visibleTo` and the
 * console enforces it: a record stamped for the wrong scope is a record a
 * site's own team cannot open. So every create names the site it belongs to
 * — `consentSiteId`, the parameter the contacts write already uses for the
 * same question — and the record is stamped exactly as that site's console
 * would stamp it ({@link crmCreateStamp}). There is no default site for the
 * reason the contacts write gives: picking the org's only site works until
 * the org has two.
 */
import {
  CRM_COLLECTIONS,
  type CrmCollection,
  consentGroupForHost,
  crmScopeTokens,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  decodeCursor,
  encodeCursor,
  listResponse,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { ApiV1Context } from '../api-v1'
import { orgOwnsHost, paginate, serialize } from './shared'

// ── Bounds ──────────────────────────────────────────────────────────────────

/** A title, a name — one line. */
export const CRM_TITLE_MAX = 200
/** Free text — notes, a body, a lost reason. */
export const CRM_TEXT_MAX = 5000
/** A short label — an industry, an outcome, a job title. */
export const CRM_LABEL_MAX = 120
/** A stored id — Firestore's own ceiling is 1,500 bytes; nothing here is close. */
export const CRM_ID_MAX = 200

// ── Collections ─────────────────────────────────────────────────────────────

/**
 * `orgs/{orgId}/{name}` — every CRM collection sits directly under the org.
 *
 * Nothing in this module dereferences `CRM_COLLECTIONS` at load time, on
 * purpose: the `/v1` suites mock `@aglyn/aglyn/server` as a closed world,
 * and a module-level `CRM_COLLECTIONS.x` would throw at import in every
 * suite that never asked for the CRM, reading as a failure of theirs.
 */
export function crmCollection(
  ctx: ApiV1Context,
  name: CrmCollection,
): FirebaseFirestore.CollectionReference {
  return ctx.firestore.collection('orgs').doc(ctx.orgId).collection(name)
}

// ── The site a write names ──────────────────────────────────────────────────

/**
 * The `consentSiteId` a create carries, validated.
 *
 * Required, and required to be one of the organization's own sites, for the
 * reason the module header gives. The message names the field so an
 * integrator sees the same key they would on a contact write.
 */
export function readCrmSite(
  ctx: ApiV1Context,
  noun: string,
  body: Record<string, unknown>,
): { siteId: string } | { response: Response } {
  const refuse = (error: string) => ({
    response: crmValidationFailed(ctx, noun, { consentSiteId: error }),
  })
  if (body.consentSiteId === undefined) {
    return refuse('Required — name the site this record belongs to')
  }
  const siteId = String(body.consentSiteId ?? '').trim()
  if (!siteId) return refuse('Must name a site')
  if (!orgOwnsHost(ctx, siteId)) return refuse('No such site in this organization')
  return { siteId }
}

/**
 * The fields every CRM create stamps, for a record created from `siteId`.
 *
 * `visibleTo` is `crmScopeTokens` — the contact create path's own expression,
 * which is what puts an API-created deal in exactly the scope a deal created
 * from that site's console would land in. `hostId` is provenance and is never
 * rewritten. `createdByUid` is the literal `'api'` because a key has no uid;
 * it is the attribution the contact create makes through `sources.api`, in
 * the field the CRM types already carry.
 *
 * Both timestamps are set here, once, so a fresh record's `updated` equals
 * its `created` and an `updatedAfter` sweep that started before the create
 * picks it up.
 */
export function crmCreateStamp(ctx: ApiV1Context, siteId: string) {
  const org = ctx.org as Record<string, unknown>
  const now = Timestamp.now()
  return {
    visibleTo: crmScopeTokens(org, consentGroupForHost(org, siteId)),
    hostId: siteId,
    createdByUid: 'api',
    createdAt: now,
    updatedAt: now,
  }
}

// ── Cross-references ────────────────────────────────────────────────────────

/**
 * Whether `uid` is a member of the authenticated organization.
 *
 * One document read at `orgs/{orgId}/members/{uid}` — the roster
 * `listOrgMembers` reads whole answers the same question for the price of
 * the whole roster, and a create should not pay for members it never asked
 * about.
 */
export async function isOrgMember(
  ctx: ApiV1Context,
  uid: string,
): Promise<boolean> {
  if (!uid) return false
  const snap = await ctx.firestore
    .collection('orgs')
    .doc(ctx.orgId)
    .collection('members')
    .doc(uid)
    .get()
  return snap.exists
}

/** A clearable scalar: a value to write, `null` to delete, absent to leave. */
export type Clearable<T> = T | null | undefined

/**
 * The membership check for an owner or assignee, run after the synchronous
 * grammar so a body that is already refused never spends the read.
 */
export async function memberError(
  ctx: ApiV1Context,
  field: string,
  uid: Clearable<string>,
): Promise<Record<string, string>> {
  if (!uid) return {}
  return (await isOrgMember(ctx, uid))
    ? {}
    : { [field]: 'Must be a member of this organization' }
}

/**
 * `values` as an `update()` payload: `null` becomes a field delete, an
 * `undefined` is left out, so an omitted key leaves the field alone and an
 * explicit `null` clears it — the PATCH contract every resource here shares.
 */
export function updatePayload(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    update[key] = value === null ? FieldValue.delete() : value
  }
  return update
}

/**
 * `values` as a `create()` payload: `null` and `undefined` are both left out,
 * because a fresh document has nothing to clear.
 */
export function createPayload(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) stored[key] = value
  }
  return stored
}

/** The three records a CRM row can point at, by the field that points. */
export interface CrmRefs {
  contactId?: string
  companyId?: string
  dealId?: string
}

/**
 * Each reference in `refs` that points at nothing, as `field → reason`.
 *
 * A dangling id is refused rather than stored because the console renders a
 * task by the contact it names, and a task pointing at a contact that does
 * not exist is a task nobody can find from anywhere. One read per reference
 * given, none for a reference omitted.
 */
export async function crmRefErrors(
  ctx: ApiV1Context,
  refs: CrmRefs,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {}
  const orgRef = ctx.firestore.collection('orgs').doc(ctx.orgId)
  const checks: Array<[keyof CrmRefs, string, string]> = [
    ['contactId', 'contacts', 'contact'],
    ['companyId', CRM_COLLECTIONS.companies, 'company'],
    ['dealId', CRM_COLLECTIONS.deals, 'deal'],
  ]
  await Promise.all(
    checks.map(async ([field, collection, noun]) => {
      const id = refs[field]
      if (!id) return
      const snap = await orgRef.collection(collection).doc(id).get()
      if (!snap.exists) errors[field] = `No such ${noun} in this organization`
    }),
  )
  return errors
}

// ── Scalar grammar ──────────────────────────────────────────────────────────

/**
 * An ISO 8601 instant as milliseconds, or `null` when the value is not one.
 *
 * `Date.parse` is permissive — it takes `"2026"` and `"March 3"` — and a
 * client sending a bare date almost always means midnight in THEIR zone,
 * which we cannot know. So only the full form is accepted: a date, a `T`, a
 * time and an offset (`Z` or `±hh:mm`). Anything less answers `null` and the
 * caller names the field.
 */
export function parseIsoInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return null
  }
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/** Milliseconds as ISO 8601, or `null` for anything that is not a finite number. */
export function isoFromMs(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null
}

/** The `created`/`updated` pair every CRM view publishes. */
export function crmTimes(data: FirebaseFirestore.DocumentData) {
  return {
    created: (serialize(data.createdAt) as string | undefined) ?? null,
    updated: (serialize(data.updatedAt) as string | undefined) ?? null,
  }
}

/**
 * A trimmed, bounded string from a body field, or `null` for an explicit
 * `null`, or `undefined` when the field was not sent.
 *
 * `null` is how a PATCH clears an optional field — the caller turns it into
 * a delete — so it has to survive as a value distinct from "absent". A
 * number or a boolean is not silently stringified: the field is named.
 */
export function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
  errors: Record<string, string>,
): string | null | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    errors[key] = 'Must be a string'
    return undefined
  }
  const text = value.trim().slice(0, max)
  return text || null
}

/** One of a fixed list, or the field is named with the list. */
export function readChoice<T extends string>(
  body: Record<string, unknown>,
  key: string,
  choices: readonly T[],
  errors: Record<string, string>,
): T | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value === 'string' && (choices as readonly string[]).includes(value)) {
    return value as T
  }
  errors[key] = `Must be one of: ${choices.join(', ')}`
  return undefined
}

/**
 * A reference id from a body field — trimmed and bounded, `null` to clear.
 *
 * Existence is the caller's question ({@link crmRefErrors}); this only rules
 * out a value that could never be an id.
 */
export function readRefId(
  body: Record<string, unknown>,
  key: string,
  errors: Record<string, string>,
): string | null | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) {
    errors[key] = 'Must be an id'
    return undefined
  }
  if (value.trim().length > CRM_ID_MAX) {
    errors[key] = 'Must be an id'
    return undefined
  }
  return value.trim()
}

/** Every key of `body` that is not in `allowed`, named as not writable. */
export function refuseUnknownKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  noun: string,
  errors: Record<string, string>,
): void {
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) continue
    errors[key] =
      key === 'consentSiteId'
        ? 'Not writable — the site is set when the record is created'
        : key === 'siteId' || key === 'hostId' || key === 'visibleTo'
          ? 'Not writable — set by the site the record was created from'
          : `Not writable on a ${noun}`
  }
}

/** The `400 validation_failed` every CRM write and filter answers with. */
export function crmValidationFailed(
  ctx: ApiV1Context,
  noun: string,
  fields: Record<string, string>,
): Response {
  return ApiErrors.badRequest({
    message: `${noun[0].toUpperCase()}${noun.slice(1)} failed validation`,
    code: 'validation_failed',
    fields,
    headers: ctx.headers,
  })
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** One `?field=value` a list accepts, in the order it prefers to index them. */
export interface CrmEqualityFilter {
  field: string
  value: string
}

/**
 * The CRM list grammar: at most one Firestore clause, the rest on the page.
 *
 * ## Why one clause
 *
 * Every equality here has a single-field index, and every list in this API
 * ends in `orderBy(__name__)`, so ONE `where` is served without anything
 * shipped. Two equalities, or an equality beside a range, is a composite
 * index per combination — five resources with four filters each is more
 * indexes than the whole product carries today, every one a query that
 * answers `500` in production until it is deployed by hand. So the FIRST
 * filter in `filters` goes to Firestore, and the caller orders them by
 * selectivity: an id before a status, because `?dealId=` selects a handful
 * of rows and `?status=open` selects most of the collection. The rest are
 * applied to the page, which can come back short — the
 * [short page](apps/docs/api/conventions.md) every filtered list already
 * documents.
 *
 * ## `updatedAfter` changes the order
 *
 * The one range filter, and the one filter that cannot be a post-filter
 * without becoming useless: a sync asking "what changed since T" over an
 * id-ordered list still walks the whole collection to find out. So when it is
 * given the list is ordered by `updated` ascending (then id), the range goes
 * to Firestore, and EVERY equality moves to the page — a range on one field
 * beside an equality on another is the composite index above. The cursor
 * carries the timestamp and the id together, at Firestore's own precision,
 * because a millisecond cursor would replay a row updated in the same
 * millisecond on the next page.
 */
export async function listCrm(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
  filters: CrmEqualityFilter[],
  view: (doc: FirebaseFirestore.QueryDocumentSnapshot) => unknown,
): Promise<Response> {
  const rawUpdatedAfter = url.searchParams.get('updatedAfter')
  const updatedAfter =
    rawUpdatedAfter === null || rawUpdatedAfter.trim() === ''
      ? null
      : parseIsoInstant(rawUpdatedAfter)
  if (rawUpdatedAfter !== null && rawUpdatedAfter.trim() !== '' && updatedAfter === null) {
    return crmValidationFailed(ctx, 'list filter', {
      updatedAfter: 'Must be an ISO 8601 instant, like 2026-09-01T00:00:00Z',
    })
  }

  const onPage = (
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
    applied: CrmEqualityFilter[],
  ) =>
    applied.length === 0
      ? docs
      : docs.filter((doc) =>
          applied.every(({ field, value }) => doc.get(field) === value),
        )

  if (updatedAfter !== null) {
    const limit = parseLimit(url.searchParams.get('limit'))
    let query: FirebaseFirestore.Query = collection
      .where('updatedAt', '>', Timestamp.fromMillis(updatedAfter))
      .orderBy('updatedAt')
      .orderBy(FieldPath.documentId())
      .limit(limit + 1)
    const cursor = decodeUpdatedCursor(decodeCursor(url.searchParams.get('cursor')))
    if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id)
    const snap = await query.get()
    const docs = snap.docs.slice(0, limit)
    const last = docs[docs.length - 1]
    const nextCursor =
      snap.docs.length > limit && last
        ? encodeCursor(encodeUpdatedCursor(last.get('updatedAt'), last.id))
        : null
    return listResponse(onPage(docs, filters).map(view), nextCursor, ctx.headers)
  }

  const [indexed, ...rest] = filters
  const query: FirebaseFirestore.Query = indexed
    ? collection.where(indexed.field, '==', indexed.value)
    : collection
  const { docs, nextCursor } = await paginate(query, url)
  return listResponse(onPage(docs, rest).map(view), nextCursor, ctx.headers)
}

/**
 * The `updated`-ordered cursor: `seconds.nanoseconds|id`.
 *
 * Firestore's own precision, not milliseconds — see `listCrm`. The id is the
 * tiebreak for two rows updated in the same instant, which a bulk import
 * produces routinely.
 */
function encodeUpdatedCursor(updatedAt: unknown, id: string): string {
  const stamp = updatedAt instanceof Timestamp ? updatedAt : Timestamp.fromMillis(0)
  return `${stamp.seconds}.${stamp.nanoseconds}|${id}`
}

function decodeUpdatedCursor(
  raw: string | undefined,
): { updatedAt: Timestamp; id: string } | null {
  if (!raw) return null
  const match = /^(\d+)\.(\d+)\|(.+)$/.exec(raw)
  if (!match) return null
  return {
    updatedAt: new Timestamp(Number(match[1]), Number(match[2])),
    id: match[3],
  }
}

/**
 * The equality filters a list URL carries, in the caller's order, with an
 * empty value meaning "absent" as every filter in this API does.
 */
export function readEqualityFilters(
  url: URL,
  fields: readonly string[],
): CrmEqualityFilter[] {
  const filters: CrmEqualityFilter[] = []
  for (const field of fields) {
    const raw = url.searchParams.get(field)
    if (raw === null) continue
    const value = raw.trim().slice(0, CRM_ID_MAX)
    if (value) filters.push({ field, value })
  }
  return filters
}
