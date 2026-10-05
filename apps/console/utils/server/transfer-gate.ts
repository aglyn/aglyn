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
import { hostScopeToken, isOrgWideMember, memberCanSee, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  parseTransferResourceKey,
  transferAccessPermissions,
  transferRouteIntent,
  type TransferApiRoute,
  type TransferErrorCode,
  type TransferErrorResponse,
} from '@aglyn/aglyn/data-transfer'
import { resolveEnabledPlugins, resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { declaredTransferResource, transferPlanRefusal } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  filterEnabledPluginsByReleaseFlags,
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
  TransferPlanRefusedError,
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
 *  3. the workspace exists, and the lockdown verdict (`status`, `fields`,
 *     `export`, `jobs` and the package route's `list` and `export` ask with
 *     a read intent, so a read-only lock still shows a job's progress and
 *     still lets the workspace take its data out);
 *  4. the member's access for the route's intent (`data-transfer/access.ts`,
 *     AGL-3546) — on the job's site for a site's records (a collaborator
 *     holding it there qualifies), on the workspace otherwise. Importing
 *     (upload, analyze, plan, apply, status, undo), the job list and
 *     packages need `data.manage`. Exporting (`export`, and `fields`, which
 *     the export dialog opens with) asks what the resource declares:
 *     `readableByMembers` admits any member (a collaborator who reaches the
 *     named site), a `readPermission` admits its holders, and otherwise
 *     `data.manage` stays the key. The route and the resource's `readPage`
 *     then read only what the member's scope sees. Staff pass.
 *  5. the resource's plugin runs for the request (AGL-3548): switched on
 *     for the named site, or for the workspace without one, and released to
 *     the workspace — the plugin dispatcher's 404 otherwise. An export the
 *     resource keeps open on every plan (the people files) is not asked;
 *  6. the workspace's plan (AGL-3555), for a resource that declares a
 *     `featureFlag`: the route's resource — the body's, or the job's — is
 *     refused on a plan without the feature, for every intent the resource
 *     does not exempt, with the owning plugin's own 403 (`planGate`, else
 *     the core's `plan_required`). Staff are refused too.
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
  package: 60,
  jobs: 120,
}

/** The routes that only read, which a read-only lock still answers. */
const READ_ROUTES: ReadonlySet<TransferApiRoute> = new Set<TransferApiRoute>(['status', 'fields', 'export', 'jobs'])

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
  /** The workspace document, as the gate read it. */
  org: Record<string, unknown>
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

/** The site and the resource a request concerns: the body's for an upload, the job's afterwards. */
async function requestSubject(
  deps: TransferEngineDeps,
  orgId: string,
  body: Record<string, unknown>,
): Promise<{ hostId: string | null; resource: string | null }> {
  if (typeof body['jobId'] === 'string' && body['jobId']) {
    const snapshot = await deps.firestore
      .collection('orgs')
      .doc(orgId)
      .collection('transferJobs')
      .doc(body['jobId'])
      .get()
    const job = snapshot.exists ? (snapshot.data() as { hostId?: string; resource?: string }) : {}
    return {
      hostId: typeof job.hostId === 'string' && job.hostId ? job.hostId : null,
      resource: typeof job.resource === 'string' && job.resource ? job.resource : null,
    }
  }
  const hostId = typeof body['hostId'] === 'string' ? body['hostId'].trim() : ''
  const resource = typeof body['resource'] === 'string' ? body['resource'].trim() : ''
  return { hostId: hostId || null, resource: resource || null }
}

/**
 * The refusal for a member without the route's access, or `null` when they
 * have it. An export needs no permission unless its resource declares one,
 * but always a membership, and a collaborator must reach the named site.
 */
async function accessRefusal(
  route: TransferApiRoute,
  orgId: string,
  hostId: string | null,
  member: CallerMember | null,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const intent = transferRouteIntent(route)
  const needed =
    intent === 'export'
      ? transferAccessPermissions('export', declaredTransferResource(parseTransferResourceKey(String(body['resource'] ?? '')).key))
      : transferAccessPermissions('import', null)
  if (!member) {
    return transferRefusal(403, 'forbidden', intent === 'export' ? 'Exporting needs a membership of this workspace' : 'Importing needs the “Manage data” permission')
  }
  if (hostId && !isOrgWideMember(member) && !memberCanSee(member, [hostScopeToken(hostId)])) {
    return transferRefusal(404, 'notFound', 'No such site')
  }
  for (const permission of needed) {
    const holds = hostId
      ? await memberHasPermissionOnHost(orgId, hostId, member, permission)
      : await memberHasOrgPermission(orgId, member, permission)
    if (holds) return null
  }
  if (!needed.length) return null
  const verb = intent === 'export' ? 'Exporting' : 'Importing'
  return transferRefusal(
    403,
    'forbidden',
    needed.length === 1 ? `${verb} needs the “Manage data” permission` : `${verb} these records needs a permission your role does not include`,
  )
}

/**
 * The refusal for a resource whose plugin does not run for the request, or
 * `null` when it does — the plugin dispatcher's own two questions
 * (`app/api/[...pluginApi]/route.ts`): is the plugin switched on for the
 * named site (the workspace's set minus the site's, AGL-1014) or, with no
 * site, for the workspace; and is it released to the workspace (AGL-422),
 * a staff token previewing a dark plugin. Answered like the dispatcher, as a
 * 404: a plugin that is off has no records to move.
 *
 * An export the resource keeps open on every plan (`featureFlagExempt:
 * ["export"]`, the people files) is not asked: taking out the people a
 * workspace holds is owed whether or not the plugin is on now — the
 * dispatcher's `portability` rule (AGL-3080). A key no plugin declares is
 * the engine's to refuse.
 */
async function pluginOffRefusal(subject: {
  resource: string
  orgId: string
  hostId: string | null
  org: Record<string, unknown> | null
  host: Record<string, unknown> | null
  route: TransferApiRoute
  authorization: string
}): Promise<Response | null> {
  const declared = declaredTransferResource(parseTransferResourceKey(subject.resource).key)
  if (!declared?.pluginId) return null
  const intent = transferRouteIntent(subject.route)
  if (intent === 'export' && declared.featureFlagExempt?.includes('export')) return null
  const enabled = subject.hostId
    ? resolveHostEnabledPlugins(
        subject.org as { enabledPlugins?: string[] },
        subject.host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
      )
    : resolveEnabledPlugins(subject.org as { enabledPlugins?: string[] })
  const released =
    enabled.includes(declared.pluginId) &&
    (
      await filterEnabledPluginsByReleaseFlags([declared.pluginId], {
        orgId: subject.orgId,
        authorization: subject.authorization,
      })
    ).includes(declared.pluginId)
  if (released) return null
  return transferRefusal(
    404,
    'notFound',
    `${declared.label} can't be ${intent === 'export' ? 'exported' : 'imported'}: ` +
      `the plugin that holds them is off for this ${subject.hostId ? 'site' : 'workspace'}.`,
  )
}

/**
 * The caller, admitted — or the response that refuses them. See the block
 * header for what is checked and in which order.
 */
export async function transferGate(
  request: Request,
  route: TransferApiRoute,
  options: {
    /** Whether this request only reads, by its body — the package route's `list` and `export`. */
    readsOnly?: (body: Record<string, unknown>) => boolean
  } = {},
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
    const { hostId, resource } = await requestSubject(deps, orgId, body)
    const host = hostId ? await getHostDocAdmin(hostId) : null
    if (hostId && (!host || host['orgId'] !== orgId)) return transferRefusal(404, 'notFound', 'No such site')
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org ?? undefined,
      host: host ?? undefined,
      intent: READ_ROUTES.has(route) || options.readsOnly?.(body) ? 'read' : 'write',
    })
    if (locked) return locked
    if (!org) return transferRefusal(404, 'notFound', 'No such workspace')

    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!staff) {
      const refusal = await accessRefusal(route, orgId, hostId, membership?.member ?? null, body)
      if (refusal) return refusal
    }
    // The plugin runs here, as the plugin dispatcher asks it of every route
    // the plugin serves (AGL-3548): switched on for the site or workspace,
    // and released to the workspace (staff preview a dark plugin).
    if (resource) {
      const off = await pluginOffRefusal({
        resource,
        orgId,
        hostId,
        org: org as Record<string, unknown>,
        host: host as Record<string, unknown> | null,
        route,
        authorization,
      })
      if (off) return off
    }
    // The workspace's plan, once the caller is admitted — staff too: the
    // plan is a fact about the workspace, not about who asks (AGL-3555).
    if (resource) {
      const planRefusal = await transferPlanRefusal(
        { resource, orgId, hostId, org: org as Record<string, unknown> },
        transferRouteIntent(route),
      )
      if (planRefusal) return Response.json(planRefusal.body, { status: planRefusal.status })
    }

    return {
      orgId,
      uid: decoded.uid,
      email: decoded.email ?? null,
      staff,
      member: membership?.member ?? null,
      org: org as Record<string, unknown>,
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
 * What a transfer route answers for a throw: a refusal for the plan as the
 * owning plugin's body, the engine's refusal as its status and code, a
 * refused credential as 401, and anything else as a 500 that names nothing
 * internal.
 */
export function transferErrorResponse(error: unknown, route: TransferApiRoute): Response {
  if (error instanceof TransferPlanRefusedError) {
    return Response.json(error.refusal.body, { status: error.refusal.status })
  }
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
