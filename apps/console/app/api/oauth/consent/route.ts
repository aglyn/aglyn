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

import { checkEntitlement, isOrgWideMember } from '@aglyn/aglyn/server'
import {
  AUTHORIZE_PARAM_NAMES,
  type AuthorizeParams,
  buildAuthorizeRedirect,
  checkRateLimit,
  connectorAccessOptions,
  type ConnectorAccessLevel,
  describeConnectorAccess,
  describeRedirectTarget,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listConnectableWorkspaces,
  lockdownRefusal,
  memberHasOrgPermission,
  mintConnectorCode,
  type RateLimitState,
  readCappedBody,
  readConnectorClient,
  reserveClientPromotion,
  resolveOrgMembership,
  scopesForAccess,
  validateAuthorizeRequest,
} from '@aglyn/tenant-data-admin'
import {
  connectorOrigin,
  refuseWhereSignInIsNotServed,
  unconfiguredOriginResponse,
} from '../../_lib/connector-oauth-http'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The consent screen's server half (AGL-4225): `/oauth/authorize` is a
 * console page, and everything it shows or does goes through here.
 *
 *  - `describe` checks the request and says what to show: the app, where it
 *    returns to, the workspaces this person can connect, and the access
 *    choices in plain words.
 *  - `allow` repeats EVERY check the API keys route makes before a key is
 *    minted — verified email, membership, org-wide reach, lockdown, plan,
 *    and "Manage API keys" — and mints a one-time code.
 *  - `deny` sends the person back with `access_denied`.
 *
 * Authenticated by the Firebase ID token in `Authorization`, as the API keys
 * route is, never by a cookie alone: a cross-site page cannot read the token,
 * so it cannot forge an approval. An impersonation session is refused
 * outright — staff acting as a customer may look, but a connection acts as
 * the customer from then on, and only the customer can agree to that.
 *
 * A bad client or redirect address is answered here as an error for the
 * page to SHOW; the page never navigates to an address this route did not
 * return, so an untrusted `redirect_uri` can never be followed.
 */
// Each action runs the lockdown verdict against the workspace it would
// connect, via `lockdownRefusal` below.

export const dynamic = 'force-dynamic'

/**
 * Approvals one account may make per window, per instance. A person
 * connecting apps by hand makes a handful; this stops a script holding one
 * session from minting codes in a loop.
 */
const ALLOWS_PER_WINDOW = 30
const ALLOWS_WINDOW_MS = 10 * 60_000
const allowsByAccount = new Map<string, RateLimitState>()

/** Largest body read: the forwarded query plus a choice. */
const MAX_CONSENT_BYTES = 16 * 1024

type Action = 'describe' | 'allow' | 'deny'

function parseQuery(query: unknown): { params: AuthorizeParams; duplicated: string[] } {
  const search = new URLSearchParams(typeof query === 'string' ? query : '')
  const params: Record<string, string> = {}
  const duplicated: string[] = []
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const values = search.getAll(name)
    if (values.length > 1) duplicated.push(name)
    if (values.length) params[name] = values[0]
  }
  return { params, duplicated }
}

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseWhereSignInIsNotServed(request)
  if (elsewhere) return elsewhere
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!idToken) return refuse(401, 'Unauthenticated')

  const text = await readCappedBody(request, MAX_CONSENT_BYTES)
  if (text === null) return refuse(413, 'Too large')
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text || '{}')
  } catch {
    return refuse(400, 'Invalid JSON')
  }
  const action = String(body.action ?? '') as Action
  if (action !== 'describe' && action !== 'allow' && action !== 'deny') {
    return refuse(400, 'Unknown action')
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (isImpersonationSession(decoded)) {
      return refuse(403, 'Only the account holder can connect an app', { reason: 'impersonation' })
    }
    if (!decoded.email_verified) return emailUnverifiedResponse()

    const resolved = connectorOrigin(request)
    if (!resolved) return unconfiguredOriginResponse()
    const origin = resolved.origin
    const { params, duplicated } = parseQuery(body.query)
    const client = await readConnectorClient(params.client_id)
    const validation = validateAuthorizeRequest(params, { origin, client, duplicated })

    if (validation.kind === 'fatal') return refuse(400, validation.reason, { reason: validation.reason })
    if (validation.kind === 'redirect') {
      // NOTHING leaves this page unless a person presses a button. A request
      // that is wrong before consent is SHOWN, with the address it would go
      // back to, and only Cancel — a deliberate click, `deny` — sends the
      // error to the client. An automatic redirect here would make our origin
      // a zero-click open redirector for anyone who registers a client.
      if (action !== 'deny') {
        return refuse(400, validation.error, {
          reason: 'request_error',
          description: validation.description,
          returnsTo: describeRedirectTarget(validation.redirectUri),
        })
      }
      return Response.json(
        {
          redirectTo: buildAuthorizeRedirect(validation.redirectUri, {
            error: validation.error,
            error_description: validation.description,
            state: validation.state,
            iss: origin,
          }),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const authorize = validation.request

    if (action === 'deny') {
      return Response.json(
        {
          redirectTo: buildAuthorizeRedirect(authorize.redirectUri, {
            error: 'access_denied',
            state: authorize.state,
            iss: origin,
          }),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const options = connectorAccessOptions(authorize.requestedScopes)

    if (action === 'describe') {
      const target = describeRedirectTarget(authorize.redirectUri)
      return Response.json(
        {
          app: {
            name: authorize.clientName,
            returnsTo: target.label,
            kind: target.kind,
            ...(target.host ? { host: target.host } : {}),
            ...(target.port ? { port: target.port } : {}),
            ...(target.path ? { path: target.path } : {}),
          },
          workspaces: await listConnectableWorkspaces(decoded.uid),
          access: options.map((level) => ({
            level,
            areas: describeConnectorAccess(scopesForAccess(level, authorize.requestedScopes)),
          })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // ── allow: every check the API keys route makes, again, here ──
    const orgId = String(body.orgId ?? '')
    const level = String(body.access ?? '') as ConnectorAccessLevel
    if (!orgId) return refuse(400, 'Choose a workspace')
    if (!options.includes(level)) return refuse(400, 'Choose what the app may do')

    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!actor || !isOrgWideMember(actor.member)) {
      return refuse(403, 'You are not a member of that workspace')
    }
    const orgSnap = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
    const org = orgSnap.data() ?? {}
    const locked = await lockdownRefusal({ request, uid: decoded.uid, org })
    if (locked) return locked
    if (!checkEntitlement(org, 'apiAccess')) {
      return refuse(403, 'Connecting apps requires the Pro plan or above', { reason: 'plan' })
    }
    if (!(await memberHasOrgPermission(orgId, actor.member, 'org.apiKeys'))) {
      return refuse(403, 'Your role does not include "Manage API keys" — ask a workspace admin', {
        reason: 'permission',
        permission: 'org.apiKeys',
      })
    }

    // Per ACCOUNT, whatever address it calls from: how often it may approve,
    // and how many never-approved clients it may bring to life a day.
    const allowance = checkRateLimit(`consent-allow:${decoded.uid}`, {
      limit: ALLOWS_PER_WINDOW,
      windowMs: ALLOWS_WINDOW_MS,
      store: allowsByAccount,
    })
    if (!allowance.allowed) {
      return refuse(429, 'Too many approvals — wait a few minutes and try again', { reason: 'rate_limited' })
    }
    if (!(await reserveClientPromotion(decoded.uid, authorize.clientId))) {
      return refuse(429, 'You have connected as many new apps as you can today — try again tomorrow', {
        reason: 'promotion_limit',
      })
    }

    const code = await mintConnectorCode({
      clientId: authorize.clientId,
      redirectUri: authorize.redirectUri,
      codeChallenge: authorize.codeChallenge,
      orgId,
      uid: decoded.uid,
      email: decoded.email ?? null,
      scopes: scopesForAccess(level, authorize.requestedScopes),
      resource: authorize.resource,
    })
    return Response.json(
      { redirectTo: buildAuthorizeRedirect(authorize.redirectUri, { code, state: authorize.state, iss: origin }) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('oauth consent failed', error instanceof Error ? error.name : 'unknown')
    return refuse(500, 'Something went wrong')
  }
}
