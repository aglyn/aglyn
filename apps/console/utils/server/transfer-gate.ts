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

import { randomUUID } from 'node:crypto'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import type { TransferApiRoute, TransferErrorCode, TransferErrorResponse } from '@aglyn/aglyn/data-transfer'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  getHostDocAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  memberHasOrgPermission,
  memberHasPermissionOnHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  TransferEngineError,
  type TransferEngineDeps,
} from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { FieldValue } from 'firebase-admin/firestore'

/*==========================================
 * THE TRANSFER ROUTES' ONE GATE (AGL-3524).
 *
 * Every `/api/transfer/*` route asks the same questions in the same order,
 * so they are asked here once:
 *
 *  1. `POST`, a JSON body naming `orgId`, and a Bearer ID token that
 *     verifies, from a verified address (or an impersonation session);
 *  2. the per-member rate limit for the route;
 *  3. the workspace exists, and the lockdown verdict (`status`, `fields`
 *     and `export` ask with a read intent, so a read-only lock still shows a
 *     job's progress and still lets the workspace take its data out);
 *  4. `data.manage` — on the job's site for a site's records (a collaborator
 *     holding it there qualifies), on the workspace otherwise. Staff pass.
 *
 * The route then hands the body to the engine
 * (`@aglyn/tenant-data-admin/server/transfer-jobs`) and maps what it throws
 * with {@link transferErrorResponse}.
 *==========================================*/

/** Requests per member per minute, per route. Apply and status are driven in a loop by the wizard. */
const RATE_LIMITS: Readonly<Record<TransferApiRoute, number>> = {
  fields: 60,
  upload: 60,
  analyze: 30,
  plan: 60,
  apply: 120,
  status: 240,
  undo: 60,
  export: 20,
}

/** The routes that only read, which a read-only lock still answers. */
const READ_ROUTES: ReadonlySet<TransferApiRoute> = new Set<TransferApiRoute>(['status', 'fields', 'export'])

/** A refusal in the shape every transfer route answers. */
export function transferRefusal(
  status: number,
  code: TransferErrorCode,
  error: string,
  details?: unknown,
  headers?: HeadersInit,
): Response {
  const body: TransferErrorResponse = { error, code, ...(details !== undefined ? { details } : {}) }
  return Response.json(body, { status, ...(headers ? { headers } : {}) })
}

/** A workspace member as `resolveOrgMembership` resolves one. */
type CallerMember = NonNullable<Awaited<ReturnType<typeof resolveOrgMembership>>>['member']

export interface TransferCaller {
  orgId: string
  uid: string
  email: string | null
  staff: boolean
  /** The caller's membership of the workspace; `null` for staff who hold none. */
  member: CallerMember | null
  body: Record<string, unknown>
  /** When the request arrived, for its time budget. */
  startedAt: number
  /** This request, as the job's driver while it holds the lease. */
  driver: string
  deps: TransferEngineDeps
}

/** The engine's dependencies in production: the Admin SDK's Firestore and the console's bucket. */
export function transferEngineDeps(): TransferEngineDeps {
  const app = firebaseAdmin.app()
  return {
    firestore: app.firestore(),
    bucket: app.storage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  }
}

/** The site a request concerns: the body's for an upload, the job's afterwards. */
async function requestHostId(
  deps: TransferEngineDeps,
  orgId: string,
  body: Record<string, unknown>,
): Promise<string | null> {
  if (typeof body['jobId'] === 'string' && body['jobId']) {
    const snapshot = await deps.firestore
      .collection('orgs')
      .doc(orgId)
      .collection('transferJobs')
      .doc(body['jobId'])
      .get()
    const hostId = snapshot.exists ? (snapshot.data() as { hostId?: string }).hostId : undefined
    return typeof hostId === 'string' && hostId ? hostId : null
  }
  const hostId = typeof body['hostId'] === 'string' ? body['hostId'].trim() : ''
  return hostId || null
}

/**
 * The caller, admitted — or the response that refuses them. See the block
 * header for what is checked and in which order.
 */
export async function transferGate(
  request: Request,
  route: TransferApiRoute,
): Promise<TransferCaller | Response> {
  const startedAt = Date.now()
  const { method, body: rawBody, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return transferRefusal(405, 'invalid', 'Method not allowed')
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>
  const orgId = typeof body['orgId'] === 'string' ? body['orgId'].trim() : ''
  if (!orgId || orgId.includes('/')) return transferRefusal(400, 'invalid', 'Missing orgId')

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return transferRefusal(401, 'unauthenticated', 'Unauthenticated')

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    const staff = decoded['staff'] === true

    const limited = await consumeRateLimit(`transfer:${route}:${decoded.uid}`, {
      limit: RATE_LIMITS[route],
      windowMs: 60_000,
    })
    if (!limited.allowed) {
      const retryAfter = Math.max(1, Math.ceil((limited.resetMs - Date.now()) / 1000))
      return transferRefusal(429, 'rateLimited', 'Too many requests. Try again in a moment.', undefined, {
        'Retry-After': String(retryAfter),
      })
    }

    const deps = transferEngineDeps()
    const org = await getOrgDoc(orgId)
    const hostId = await requestHostId(deps, orgId, body)
    const host = hostId ? await getHostDocAdmin(hostId) : null
    if (hostId && (!host || host['orgId'] !== orgId)) return transferRefusal(404, 'notFound', 'No such site')
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org ?? undefined,
      host: host ?? undefined,
      intent: READ_ROUTES.has(route) ? 'read' : 'write',
    })
    if (locked) return locked
    if (!org) return transferRefusal(404, 'notFound', 'No such workspace')

    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!staff) {
      const allowed = hostId
        ? await memberHasPermissionOnHost(orgId, hostId, membership?.member, 'data.manage')
        : await memberHasOrgPermission(orgId, membership?.member, 'data.manage')
      if (!allowed) return transferRefusal(403, 'forbidden', 'Importing needs the “Manage data” permission')
    }

    return {
      orgId,
      uid: decoded.uid,
      email: decoded.email ?? null,
      staff,
      member: membership?.member ?? null,
      body,
      startedAt,
      driver: `request:${randomUUID()}`,
      deps,
    }
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    return transferErrorResponse(error, route)
  }
}

/**
 * What a transfer route answers for a throw: the engine's refusal as its
 * status and code, a refused credential as 401, and anything else as a 500
 * that names nothing internal.
 */
export function transferErrorResponse(error: unknown, route: TransferApiRoute): Response {
  if (error instanceof TransferEngineError) {
    return transferRefusal(error.status, error.code, error.message, error.details)
  }
  const unauthenticated = invalidIdTokenResponse(error)
  if (unauthenticated) return unauthenticated
  console.error(`[transfer/${route}] failed`, error)
  return transferRefusal(500, 'failed', 'The import step failed. Try again.')
}

/**
 * The audit row for an export: what was taken out and how much, never the
 * content — a copy of the records leaving the platform is worth a row; what
 * was in it is not ours to log.
 */
export async function auditTransferExport(caller: TransferCaller, after: Record<string, unknown>): Promise<void> {
  await addAdminAudit(caller.deps.firestore, {
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'data.transfer.export',
    target: `orgs/${caller.orgId}/transfer/${String(after['resource'] ?? '')}`,
    before: null,
    after,
    at: FieldValue.serverTimestamp(),
  })
}

/** The audit row for a step that decides or changes data: plan, apply and undo. */
export async function auditTransfer(
  caller: TransferCaller,
  action: 'data.transfer.plan' | 'data.transfer.apply' | 'data.transfer.undo',
  jobId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await addAdminAudit(caller.deps.firestore, {
    actorUid: caller.uid,
    actorEmail: caller.email,
    action,
    target: `orgs/${caller.orgId}/transferJobs/${jobId}`,
    before: null,
    after,
    at: FieldValue.serverTimestamp(),
  })
}
