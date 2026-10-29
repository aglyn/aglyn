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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { Writable } from 'node:stream'
import {
  inspectUploadBytes,
  UPLOAD_INSPECTION_HEAD_BYTES,
} from '@aglyn/aglyn/app-utils/upload-inspection'
import { isSvgUploadType, sanitizeSvgBuffer } from '@aglyn/aglyn/app-utils/sanitize-svg'
import {
  checkVisitorUploadRequest,
  isVisitorUploadScope,
  isVisitorUploadSegment,
  visitorUploadFinalPath,
  visitorUploadFolder,
  visitorUploadIsInline,
  visitorUploadPendingPath,
  visitorUploadTypeOf,
  VISITOR_UPLOAD_COUNTER_BYTES,
  VISITOR_UPLOAD_COUNTER_FILES,
  VISITOR_UPLOAD_MAX_BYTES,
  VISITOR_UPLOAD_TICKET_TTL_MS,
  type VisitorUploadFile,
  type VisitorUploadKind,
  type VisitorUploadScope,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import {
  uploadStorageGate,
  type UploadStorageRefusal,
} from '@aglyn/aglyn/plugin-manager/plugin-upload-storage-gate'
import firebaseAdmin from './firebase-admin'
import { featureLockdownRefusal } from './lockdown'
import { consumeRateLimit } from './rate-limit-store'

/*==========================================
 * TAKING A FILE FROM A SITE'S VISITOR, OR A MEMBER (AGL-4096).
 *
 * Two calls a plugin's own routes make, after deciding for themselves who may
 * upload for what (a quote's signed link, a form's binding, a member's key):
 *
 *   mintVisitorUploadTicket   → a TICKET and a signed upload for one file of a
 *                               declared name, type and size, to a PENDING
 *                               path scoped to (site, purpose, record);
 *   finalizeVisitorUpload     → reads what arrived there, checks its size and
 *                               bytes (`inspectUploadBytes`), strips script
 *                               from an SVG, moves it to the record's private
 *                               folder and answers its {@link VisitorUploadFile}.
 *
 * And three for afterwards: {@link readVisitorUpload} (a kept file's record,
 * by id, so a later submit names files by id and nothing else),
 * {@link sendVisitorUploadFile} (serve one through a gated route) and
 * {@link deleteVisitorUpload} / {@link deleteVisitorUploads}.
 *
 * THE UPLOAD IS A SIGNED POST POLICY, not a signed PUT URL. A site lives on
 * any domain, and the bucket's cross-origin list names the console's
 * addresses one by one and never `*` (AGL-1452), so a browser on a
 * customer's domain could not make the PUT. A form post needs no such
 * permission. The policy binds the exact object, the type and the size range
 * and lapses after {@link VISITOR_UPLOAD_TICKET_TTL_MS}, so Storage itself
 * refuses anything else; finalize then checks again, because the bytes are
 * what matter.
 *
 * THE TICKET is `<payload>.<signature>`: the scope, the upload's id, its
 * type, size and name and when it lapses, HMAC-signed under
 * `TOKEN_SIGNING_SECRET` with a `visitor-upload:` prefix so it cannot be
 * replayed as any other token. Nothing is stored per ticket. It is an
 * internal handle for the seconds between upload and finalize, never a state
 * anyone sees.
 *
 * WHAT IS NEVER FINALIZED is deleted by the bucket's lifecycle a day after it
 * arrived: `visitor-uploads-pending/` in `cloud/media-bucket-lifecycle.json`.
 * A refused finalize deletes its object at once.
 *
 * THE KEPT FILE has no download token and lives under `hosts/{hostId}/private/`,
 * so only the Admin SDK reads it, the site's erasure deletes it with the
 * site, and a route that checked the caller serves it
 * ({@link sendVisitorUploadFile}: `nosniff`, a sandboxing CSP, and
 * `attachment` for everything but the raster images a browser draws safely).
 *
 * Abuse: each ticket spends a per-caller and a per-site rate limit, the
 * platform's uploads pause (`uploads` lockdown feature) refuses new tickets,
 * and the plugin route sits behind the site dispatcher's cross-origin check,
 * lockdown and visitor-write limit.
 *
 * STORAGE. A kept file counts toward the workspace's storage exactly as a
 * media library file does: finalize adds its bytes to the site's storage
 * counter (`hosts/{hostId}/counters/media`, `bytes` plus the
 * `uploadBytes`/`uploadCount` share, see `VISITOR_UPLOAD_COUNTER_BYTES`),
 * the figure the storage band, the Billing meter, the usage alerts and the
 * invoice read. Deleting a kept file takes its bytes off again. A file that
 * was counted carries `storageCounted` in its metadata, so a file kept before
 * files were counted releases nothing it never added, and only the delete
 * that actually removed the object releases its bytes.
 *
 * Who is refused for storage:
 *
 * - A MEMBER's file (a quote's proof, `caller: { uid }`) meets the same band
 *   a library upload does, through `core.upload-storage-gate`: refused past
 *   the allowance on a plan that does not bill storage, taken and billed past
 *   it on one that does, refused past a storage cap the workspace set.
 * - A VISITOR's file (`caller: { ip }`: a customer's artwork on a quote, a
 *   form's file) is NEVER refused for the business's storage. The customer
 *   cannot free space or upgrade the plan, and a request or an approval lost
 *   to the business's storage is a lost customer. The file is kept and
 *   counted all the same, so past the allowance a plan that bills storage
 *   bills it, a plan that does not stops the business's own uploads until
 *   space is freed, and the usage alerts tell the owner either way. What
 *   bounds a visitor is what bounded one before: the size and file limits,
 *   the rate limits, the uploads pause, and for a form the plan's submission
 *   allowance.
 *=========================================*/

/** The few Storage calls this makes, so a spec can stand in for the bucket. */
export interface VisitorUploadObject {
  generateSignedPostPolicyV4(options: {
    expires: number
    conditions?: unknown[]
    fields?: Record<string, string>
  }): Promise<[{ url: string; fields: Record<string, string> }] | Array<{ url: string; fields: Record<string, string> }>>
  exists(): Promise<[boolean] | boolean[]>
  getMetadata(): Promise<[VisitorUploadObjectMetadata] | VisitorUploadObjectMetadata[]>
  download(options?: { start?: number; end?: number }): Promise<[Buffer] | Buffer[]>
  save(data: Buffer, options: Record<string, unknown>): Promise<unknown>
  move(destination: string): Promise<unknown>
  setMetadata(metadata: Record<string, unknown>): Promise<unknown>
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>
  createReadStream(): NodeJS.ReadableStream
}

export interface VisitorUploadObjectMetadata {
  size?: string | number
  contentType?: string
  metadata?: Record<string, string | null | undefined> | null
}

/** An object as a listing answers it: its name, its metadata, and a way to delete it. */
export interface VisitorUploadListedObject {
  name: string
  metadata?: VisitorUploadObjectMetadata | null
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>
}

export interface VisitorUploadBucket {
  file(path: string): VisitorUploadObject
  /** Every object under a prefix, with its metadata (Storage answers `[files, nextQuery, response]`). */
  getFiles(options: { prefix: string }): Promise<[VisitorUploadListedObject[], ...unknown[]]>
}

/** How a kept file moves its site's storage counter: `+` when kept, `-` when deleted. */
export interface VisitorUploadStorageDelta {
  bytes: number
  files: number
}

export interface VisitorUploadDeps {
  bucket(): VisitorUploadBucket
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean; resetMs: number }>
  /** Whether the platform's uploads pause (`uploads` lockdown feature) is on. */
  uploadsPaused(): Promise<boolean>
  /** The secret tickets are signed with. Throws when none is configured. */
  secret(): string
  now(): number
  /** A fresh upload id: a path segment no one can guess. */
  newId(): string
  /**
   * Moves the site's storage counter (`hosts/{hostId}/counters/media`) by a
   * kept file: its bytes in `bytes`, the figure every storage reader reads,
   * and in the kept files' own share beside it.
   */
  countStorage(hostId: string, delta: VisitorUploadStorageDelta): Promise<void>
  /**
   * The workspace's storage band, asked before a MEMBER's file is taken:
   * `null` to take it. Never asked for a visitor's. Absent, the file is taken.
   */
  storageGate?(input: { hostId: string; bytes: number }): Promise<UploadStorageRefusal | null>
}

export function defaultVisitorUploadDeps(): VisitorUploadDeps {
  return {
    // The bucket the site's `connect-src` admits by name (`security-origins.js`,
    // `visitorUploadConnectSource`), so the browser's post is allowed to leave.
    bucket: () =>
      firebaseAdmin
        .app()
        .storage()
        .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] || undefined) as unknown as VisitorUploadBucket,
    consumeRateLimit: (key, options) => consumeRateLimit(key, options),
    uploadsPaused: async () => (await featureLockdownRefusal({ feature: 'uploads' })) !== null,
    secret: () => {
      const secret = process.env['TOKEN_SIGNING_SECRET']
      if (!secret) throw new Error('TOKEN_SIGNING_SECRET is not configured')
      return secret
    },
    now: () => Date.now(),
    newId: () => randomBytes(12).toString('hex'),
    countStorage: async (hostId, delta) => {
      const increment = firebaseAdmin.firestore.FieldValue.increment
      await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('counters')
        .doc('media')
        .set(
          {
            bytes: increment(delta.bytes),
            [VISITOR_UPLOAD_COUNTER_BYTES]: increment(delta.bytes),
            [VISITOR_UPLOAD_COUNTER_FILES]: increment(delta.files),
          },
          { merge: true },
        )
    },
    // The console registers the band (`core.upload-storage-gate`); the site
    // app registers none and never takes a member's file.
    storageGate: async (input) => (await uploadStorageGate()?.check(input)) ?? null,
  }
}

/** One rate limit: so many in so long. */
export interface VisitorUploadRate {
  limit: number
  windowMs: number
}

/** The limits a ticket spends, per caller on a site and per site. */
export interface VisitorUploadLimits {
  perCaller: VisitorUploadRate
  perSite: VisitorUploadRate
}

/**
 * Tickets per caller on one site: 30 in ten minutes is three full
 * submissions of ten files; per site, 300 an hour across everyone.
 */
export const VISITOR_UPLOAD_LIMITS: VisitorUploadLimits = {
  perCaller: { limit: 30, windowMs: 10 * 60_000 },
  perSite: { limit: 300, windowMs: 60 * 60_000 },
}

/** Finalizes per caller on one site, per ten minutes: a retry or two per ticket. */
export const VISITOR_UPLOAD_FINALIZE_LIMIT: VisitorUploadRate = { limit: 60, windowMs: 10 * 60_000 }

/** How long after its upload lapses a ticket may still be finalized: a slow connection's last bytes. */
export const VISITOR_UPLOAD_FINALIZE_GRACE_MS = 60 * 60_000

/** Who is uploading: an address for a visitor, a uid for a member. Keys the per-caller limit. */
export type VisitorUploadCaller = { ip: string } | { uid: string }

export type VisitorUploadRefusal = {
  ok: false
  status: number
  error: string
  code:
    | 'type'
    | 'size'
    | 'empty'
    | 'scope'
    | 'rate'
    | 'paused'
    | 'storage'
    | 'ticket'
    | 'missing'
    | 'inspection'
    | 'unchecked'
  retryAfterSeconds?: number
}

const refusal = (
  status: number,
  code: VisitorUploadRefusal['code'],
  error: string,
  extra: Partial<VisitorUploadRefusal> = {},
): VisitorUploadRefusal => ({ ok: false, status, code, error, ...extra })

const callerKey = (caller: VisitorUploadCaller) => ('uid' in caller ? `uid:${caller.uid}` : `ip:${caller.ip || 'no-address'}`)

/*------------------------------------------
 * The ticket
 *-----------------------------------------*/

interface TicketPayload {
  h: string
  p: string
  i: string
  u: string
  t: string
  s: number
  n: string
  e: number
}

function signTicket(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`visitor-upload:${payload}`).digest('base64url')
}

function mintTicket(secret: string, payload: TicketPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signTicket(secret, encoded)}`
}

/** A ticket's payload when its signature holds, else null. Expiry is the caller's to judge. */
function readTicket(secret: string, ticket: unknown): TicketPayload | null {
  if (typeof ticket !== 'string' || ticket.length > 2_000) return null
  const separator = ticket.lastIndexOf('.')
  if (separator <= 0) return null
  const encoded = ticket.slice(0, separator)
  const presented = Buffer.from(ticket.slice(separator + 1))
  const expected = Buffer.from(signTicket(secret, encoded))
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketPayload
    if (
      !isVisitorUploadScope({ hostId: payload.h, purpose: payload.p, purposeId: payload.i }) ||
      !isVisitorUploadSegment(payload.u) ||
      !visitorUploadTypeOf(String(payload.t)) ||
      !Number.isSafeInteger(payload.s) ||
      typeof payload.n !== 'string' ||
      !Number.isSafeInteger(payload.e)
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

/*------------------------------------------
 * Mint
 *-----------------------------------------*/

export interface VisitorUploadTicket {
  ok: true
  /** Handed back to finalize. */
  ticket: string
  /** The signed form post: where, and the fields that go before the file. */
  upload: { url: string; fields: Record<string, string> }
  /** The file as it will be kept. */
  file: { id: string; name: string; contentType: string; size: number }
}

/**
 * A ticket and a signed upload for ONE file, after the caller's route has
 * decided the caller may upload for `scope`. Spends the rate limits; refused
 * while the platform's uploads are paused, and a member's file when the
 * workspace's storage band refuses it (never a visitor's). `maxBytes`
 * narrows the 25 MB ceiling, never widens it; `kinds` narrows the types
 * taken (a form field that asks for PDFs only), never widens them.
 */
export async function mintVisitorUploadTicket(
  deps: VisitorUploadDeps,
  input: {
    scope: VisitorUploadScope
    request: unknown
    caller: VisitorUploadCaller
    limits?: VisitorUploadLimits
    maxBytes?: number
    kinds?: readonly VisitorUploadKind[]
  },
): Promise<VisitorUploadTicket | VisitorUploadRefusal> {
  const { scope } = input
  if (!isVisitorUploadScope(scope)) return refusal(400, 'scope', 'This upload is missing what it is for.')
  const checked = checkVisitorUploadRequest(input.request, { maxBytes: input.maxBytes, kinds: input.kinds })
  if ('error' in checked) return refusal(checked.code === 'size' ? 413 : 400, checked.code, checked.error)
  if (await deps.uploadsPaused()) {
    return refusal(423, 'paused', 'Uploads are paused for a moment. Try again a little later.')
  }
  // A member's file meets the storage band a library upload meets; a
  // visitor's is never refused for the business's storage (see STORAGE).
  if ('uid' in input.caller && deps.storageGate) {
    const full = await deps.storageGate({ hostId: scope.hostId, bytes: checked.upload.size })
    if (full) return refusal(full.status, 'storage', full.error)
  }
  const limits = input.limits ?? VISITOR_UPLOAD_LIMITS
  for (const [key, rate] of [
    [`visitor-upload:${scope.hostId}:${callerKey(input.caller)}`, limits.perCaller],
    [`visitor-upload-site:${scope.hostId}`, limits.perSite],
  ] as const) {
    const spent = await deps.consumeRateLimit(key, rate)
    if (!spent.allowed) {
      return refusal(429, 'rate', 'Too many files at once. Wait a few minutes and try again.', {
        retryAfterSeconds: Math.max(1, Math.ceil((spent.resetMs - deps.now()) / 1000)),
      })
    }
  }

  const { upload } = checked
  const id = deps.newId()
  const expiresAtMs = deps.now() + VISITOR_UPLOAD_TICKET_TTL_MS
  const answer = await deps
    .bucket()
    .file(visitorUploadPendingPath(scope, id))
    .generateSignedPostPolicyV4({
      expires: expiresAtMs,
      // Storage refuses a post of any other size, type or object: each
      // field below is also an exact-match condition of the policy.
      conditions: [['content-length-range', 1, upload.size]],
      fields: { 'Content-Type': upload.type.contentType },
    })
  const signed = answer[0]
  return {
    ok: true,
    ticket: mintTicket(deps.secret(), {
      h: scope.hostId,
      p: scope.purpose,
      i: scope.purposeId,
      u: id,
      t: upload.type.contentType,
      s: upload.size,
      n: upload.name,
      e: expiresAtMs,
    }),
    upload: { url: signed.url, fields: signed.fields },
    file: { id, name: upload.name, contentType: upload.type.contentType, size: upload.size },
  }
}

/*------------------------------------------
 * Finalize
 *-----------------------------------------*/

const first = <T,>(answer: [T] | T[]): T => answer[0] as T

/**
 * The custom metadata key a kept file carries once its bytes are in its
 * site's storage counter. A file kept before files were counted has none, so
 * deleting it releases nothing it never added.
 */
const STORAGE_COUNTED = 'storageCounted'

/** The custom metadata a kept file carries, which is how its record is read back. */
function keptMetadata(name: string, uploadedAtMs: number): Record<string, string | null> {
  return {
    name,
    uploadedAtMs: String(uploadedAtMs),
    // Never a download token: nothing but the Admin SDK reads the object.
    firebaseStorageDownloadTokens: null,
    [STORAGE_COUNTED]: '1',
  }
}

/**
 * Adds a file just kept to its site's storage. Never the uploader's problem:
 * the file stays kept whatever the counter does, and if the counter could
 * not be moved the file's mark comes off, so deleting it later releases
 * nothing it never added.
 */
async function countKept(
  deps: Pick<VisitorUploadDeps, 'countStorage'>,
  hostId: string,
  size: number,
  kept: VisitorUploadObject,
): Promise<void> {
  try {
    await deps.countStorage(hostId, { bytes: size, files: 1 })
  } catch (error) {
    console.error('a kept upload was not counted toward storage', { hostId, error })
    await kept.setMetadata({ metadata: { [STORAGE_COUNTED]: null } }).catch(() => undefined)
  }
}

/** A kept file's record from its object's metadata, or null when it is not one. */
function recordFromMetadata(path: string, id: string, metadata: VisitorUploadObjectMetadata): VisitorUploadFile | null {
  const contentType = String(metadata.contentType ?? '')
  const size = Number(metadata.size)
  const name = String(metadata.metadata?.['name'] ?? '')
  if (!visitorUploadTypeOf(contentType) || !Number.isSafeInteger(size) || size <= 0 || !name) return null
  return {
    id,
    name,
    contentType,
    size,
    path,
    uploadedAtMs: Number(metadata.metadata?.['uploadedAtMs']) || 0,
  }
}

/**
 * Checks and keeps the file a ticket signed for. The ticket must be one this
 * signed, for this `scope`, not long lapsed. Idempotent: a retried finalize
 * of a file already kept answers its record.
 */
export async function finalizeVisitorUpload(
  deps: VisitorUploadDeps,
  input: { scope: VisitorUploadScope; ticket: unknown; caller: VisitorUploadCaller },
): Promise<{ ok: true; file: VisitorUploadFile } | VisitorUploadRefusal> {
  const { scope } = input
  if (!isVisitorUploadScope(scope)) return refusal(400, 'scope', 'This upload is missing what it is for.')
  const spent = await deps.consumeRateLimit(
    `visitor-upload-finalize:${scope.hostId}:${callerKey(input.caller)}`,
    VISITOR_UPLOAD_FINALIZE_LIMIT,
  )
  if (!spent.allowed) {
    return refusal(429, 'rate', 'Too many files at once. Wait a few minutes and try again.', {
      retryAfterSeconds: Math.max(1, Math.ceil((spent.resetMs - deps.now()) / 1000)),
    })
  }
  const ticket = readTicket(deps.secret(), input.ticket)
  const lapsed = 'This upload took too long. Send the file again.'
  if (
    !ticket ||
    ticket.h !== scope.hostId ||
    ticket.p !== scope.purpose ||
    ticket.i !== scope.purposeId
  ) {
    return refusal(400, 'ticket', lapsed)
  }
  if (deps.now() > ticket.e + VISITOR_UPLOAD_FINALIZE_GRACE_MS) return refusal(410, 'ticket', lapsed)

  const bucket = deps.bucket()
  const finalPath = visitorUploadFinalPath(scope, ticket.u)
  const kept = bucket.file(finalPath)
  if (first(await kept.exists())) {
    const record = recordFromMetadata(finalPath, ticket.u, first(await kept.getMetadata()))
    if (record) return { ok: true, file: record }
  }

  const pending = bucket.file(visitorUploadPendingPath(scope, ticket.u))
  if (!first(await pending.exists())) {
    return refusal(409, 'missing', `We didn’t receive ${ticket.n}. Try sending it again.`)
  }
  const discard = async <T,>(answer: T): Promise<T> => {
    await pending.delete({ ignoreNotFound: true }).catch(() => undefined)
    return answer
  }
  const metadata = first(await pending.getMetadata())
  const size = Number(metadata.size)
  const contentType = String(metadata.contentType ?? '')
  if (contentType !== ticket.t) {
    return discard(refusal(415, 'type', `${ticket.n} arrived as a different kind of file. Send it again.`))
  }
  if (!Number.isSafeInteger(size) || size <= 0) return discard(refusal(400, 'empty', `${ticket.n} is empty.`))
  if (size > ticket.s || size > VISITOR_UPLOAD_MAX_BYTES) {
    return discard(refusal(413, 'size', `${ticket.n} is larger than it said it was. Send it again.`))
  }

  // The bytes against the type: a few KB from the front, or all of an SVG,
  // which is text and is stripped of script below. Unlike the console's
  // media route this fails CLOSED: a visitor's file that could not be looked
  // at is not kept.
  let bytes: Buffer
  try {
    bytes = isSvgUploadType(contentType)
      ? first(await pending.download())
      : first(await pending.download({ start: 0, end: Math.min(size, UPLOAD_INSPECTION_HEAD_BYTES) - 1 }))
  } catch {
    return discard(refusal(503, 'unchecked', `${ticket.n} could not be checked. Send it again.`))
  }
  const inspected = inspectUploadBytes({ bytes, contentType, fileName: ticket.n })
  if (inspected) return discard(refusal(415, 'inspection', inspected.message))

  const uploadedAtMs = deps.now()
  const disposition = contentDisposition(ticket.n, contentType)
  if (isSvgUploadType(contentType)) {
    const sanitized = sanitizeSvgBuffer(bytes)
    await kept.save(sanitized.buffer, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'private, no-store',
        contentDisposition: disposition,
        metadata: keptMetadata(ticket.n, uploadedAtMs),
      },
    })
    await pending.delete({ ignoreNotFound: true }).catch(() => undefined)
    await countKept(deps, scope.hostId, sanitized.buffer.length, kept)
    return {
      ok: true,
      file: { id: ticket.u, name: ticket.n, contentType, size: sanitized.buffer.length, path: finalPath, uploadedAtMs },
    }
  }
  await pending.move(finalPath)
  await kept.setMetadata({
    cacheControl: 'private, no-store',
    contentDisposition: disposition,
    metadata: keptMetadata(ticket.n, uploadedAtMs),
  })
  await countKept(deps, scope.hostId, size, kept)
  return { ok: true, file: { id: ticket.u, name: ticket.n, contentType, size, path: finalPath, uploadedAtMs } }
}

/*------------------------------------------
 * Afterwards
 *-----------------------------------------*/

/** A kept file's record, by its id within `scope`; null when there is none. */
export async function readVisitorUpload(
  deps: Pick<VisitorUploadDeps, 'bucket'>,
  scope: VisitorUploadScope,
  id: string,
): Promise<VisitorUploadFile | null> {
  if (!isVisitorUploadScope(scope) || !isVisitorUploadSegment(id)) return null
  const path = visitorUploadFinalPath(scope, id)
  const file = deps.bucket().file(path)
  if (!first(await file.exists())) return null
  return recordFromMetadata(path, id, first(await file.getMetadata()))
}

const isNotFound = (error: unknown): boolean =>
  Number((error as { code?: unknown } | null)?.code) === 404

/** Deletes one object; true only when this call is the one that removed it. */
async function deleteObject(object: Pick<VisitorUploadObject, 'delete'>): Promise<boolean> {
  try {
    await object.delete()
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

/**
 * Takes deleted files' bytes off their site's storage: the ones that were
 * counted, by the size each was kept at. Never throws, so a counter that
 * could not be moved never fails the delete it follows.
 */
async function releaseCounted(
  deps: Pick<VisitorUploadDeps, 'countStorage'>,
  hostId: string,
  deleted: ReadonlyArray<VisitorUploadObjectMetadata | null | undefined>,
): Promise<void> {
  let bytes = 0
  let files = 0
  for (const metadata of deleted) {
    if (metadata?.metadata?.[STORAGE_COUNTED] !== '1') continue
    const size = Number(metadata.size)
    if (!Number.isSafeInteger(size) || size <= 0) continue
    bytes += size
    files += 1
  }
  if (!files) return
  try {
    await deps.countStorage(hostId, { bytes: -bytes, files: -files })
  } catch (error) {
    console.error('deleted uploads were not taken off storage', { hostId, bytes, files, error })
  }
}

/** Deletes one kept file and releases its bytes. Gone already is fine. */
export async function deleteVisitorUpload(
  deps: Pick<VisitorUploadDeps, 'bucket' | 'countStorage'>,
  path: string,
): Promise<void> {
  if (!path.startsWith('hosts/') || !path.includes('/private/uploads/')) return
  const hostId = path.split('/')[1] ?? ''
  if (!isVisitorUploadSegment(hostId)) return
  const file = deps.bucket().file(path)
  let metadata: VisitorUploadObjectMetadata
  try {
    metadata = first(await file.getMetadata())
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
  if (await deleteObject(file)) await releaseCounted(deps, hostId, [metadata])
}

/** Deletes every kept file of one purpose and record, and releases their bytes. */
export async function deleteVisitorUploads(
  deps: Pick<VisitorUploadDeps, 'bucket' | 'countStorage'>,
  scope: VisitorUploadScope,
): Promise<void> {
  if (!isVisitorUploadScope(scope)) return
  const [listed = []] = await deps.bucket().getFiles({ prefix: visitorUploadFolder(scope) })
  const deleted = await Promise.all(
    listed.map(async (object) => ((await deleteObject(object)) ? object.metadata : null)),
  )
  await releaseCounted(deps, scope.hostId, deleted)
}

/** An ASCII stand-in for a header, and the real name encoded beside it. */
function contentDisposition(name: string, contentType: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file'
  const kind = visitorUploadIsInline(contentType) ? 'inline' : 'attachment'
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** The headers a kept file is served with. */
export function visitorUploadResponseHeaders(file: Pick<VisitorUploadFile, 'name' | 'contentType'>): Record<string, string> {
  return {
    'Content-Type': file.contentType,
    'Content-Disposition': contentDisposition(file.name, file.contentType),
    'X-Content-Type-Options': 'nosniff',
    // Whatever the bytes turn out to be, they run nothing and load nothing.
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}

/** The response a gated route streams a kept file into. */
export interface VisitorUploadResponse extends Writable {
  setHeader(name: string, value: string): void
  status(code: number): unknown
}

/**
 * Streams a kept file to a route's response, after the route has checked the
 * caller. The file is never held whole in memory.
 */
export async function sendVisitorUploadFile(
  deps: Pick<VisitorUploadDeps, 'bucket'>,
  res: VisitorUploadResponse,
  file: Pick<VisitorUploadFile, 'path' | 'name' | 'contentType'>,
): Promise<void> {
  for (const [name, value] of Object.entries(visitorUploadResponseHeaders(file))) res.setHeader(name, value)
  res.status(200)
  await pipeline(deps.bucket().file(file.path).createReadStream(), res)
}
