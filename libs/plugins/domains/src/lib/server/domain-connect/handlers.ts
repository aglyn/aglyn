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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import type {
  DomainConnectDiscoverResponse,
  DomainConnectFinishResponse,
  DomainConnectReturnMessage,
  DomainConnectStartResponse,
} from '../../model/domain-connect'
import type { DomainConnectConfig } from './config'
import type { DomainConnectDiscovery } from './discovery'
import { advanceDomainConnectSession, type DomainConnectEngineDeps } from './engine'
import { domainConnectReturnPage } from './return-page'
import {
  domainConnectSessionId,
  newDomainConnectSession,
  sessionAfterReturn,
  type DomainConnectSession,
} from './session'
import { buildSignedApplyUrl } from './signing'

/*
 * THE FOUR DOORS OF ONE-CLICK DNS (AGL-3963).
 *
 *   GET  domain-connect/discover?hostId&domain   can the provider do it?
 *   POST domain-connect/start   {hostId, domain} a signed link to it
 *   POST domain-connect/finish  {hostId, state}  check, and connect
 *   GET  domain-connect/return?state&error       the provider's redirect
 *
 * The console dispatcher has already refused a site with this plugin off,
 * an unverified account, a lockdown and a caller over the write limit. The
 * three member doors then ask what `/api/domains/attach` asks, in the same
 * order and with the same answers: a verified bearer token, an admin of the
 * site, and a plan with custom domains. A domain is connected through core's
 * `connectHostCustomDomain` and nothing else, so the claim, the attach and
 * the redirect are the ones the manual button makes.
 *
 * The return door carries no token — it is a browser coming back from the
 * DNS provider — so it acts on almost nothing: it finds the session by the
 * hash of its state, records whether the provider said yes, and hands the
 * outcome to the console window. Checking DNS and connecting happen in
 * `finish`, with the member's own session, or in the sweep.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })
const refusal = (status: number, error: string, code: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export interface DomainConnectSite {
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
}

export interface DomainConnectCaller {
  uid: string
  email: string | null
  staff: boolean
}

export interface DomainConnectRouteDeps {
  config(): DomainConnectConfig | null
  /** The verified caller, `'refused'` for a token the verifier rejected. */
  verifyIdToken(token: string): Promise<
    | (DomainConnectCaller & { emailVerified: boolean })
    | 'refused'
  >
  readSite(hostId: string): Promise<DomainConnectSite | null>
  entitled(org: Record<string, unknown>): boolean
  /** `validatePlatformDomain`, with the attach route's copy. */
  validateDomain(input: string): { domain: string | null; error: string | null }
  discover(domain: string, providerId: string): Promise<DomainConnectDiscovery>
  /** Whether a site other than `hostId` holds any of `names`, as its domain or its twin. */
  heldElsewhere(names: readonly string[], hostId: string): Promise<boolean>
  /** `/{orgSlug}/hosts/{subdomain}/admin/domain` for the session's site, or null. */
  customDomainPath(session: DomainConnectSession): Promise<string | null>
  engine: DomainConnectEngineDeps
  newState(): string
  now(): number
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

interface Gated {
  caller: DomainConnectCaller
  site: DomainConnectSite
  hostId: string
  body: Record<string, unknown>
}

/**
 * The member gate, in `/api/domains/attach`'s order and words: a token, a
 * verified address, a named site, its admin, and the plan.
 */
async function memberGate(request: Request, deps: DomainConnectRouteDeps): Promise<Gated | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refusal(401, 'Unauthenticated', 'unauthenticated')
  const caller = await deps.verifyIdToken(authorization.slice('Bearer '.length))
  if (caller === 'refused') return refusal(401, 'Unauthenticated', 'unauthenticated')
  if (!caller.emailVerified) return refusal(403, 'Verify your email address first', 'email-unverified')
  const body = await readBody(request)
  const hostId = String(body['hostId'] ?? new URL(request.url).searchParams.get('hostId') ?? '')
  if (!DOCUMENT_ID.test(hostId)) return refusal(400, 'Missing domain or hostId', 'invalid-request')
  const site = await deps.readSite(hostId)
  if (!site) return refusal(404, 'Unknown site', 'unknown-site')
  // "Manage site settings" (`site.manage`, AGL-4047); the reason code stays.
  if (!caller.staff && !holdsSiteKey(site.host, caller.uid, 'site.manage')) {
    return refusal(403, siteKeyRefusal('site.manage'), 'not-admin')
  }
  if (!deps.entitled(site.org)) {
    return refusal(403, 'Custom domains require a Starter plan', 'not-entitled')
  }
  return {
    caller: { uid: caller.uid, email: caller.email, staff: caller.staff },
    site,
    hostId,
    body,
  }
}

const NOT_SUPPORTED: DomainConnectDiscoverResponse = { supported: false }

/** `GET domain-connect/discover`: whether to draw the button, and its name. */
export function createDiscoverRoute(deps: DomainConnectRouteDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return refusal(405, 'Method not allowed', 'method-not-allowed')
    const config = deps.config()
    // No signing key, no offer: the widget draws nothing, and nobody is told
    // about a setting only the platform can change.
    if (!config) return json(NOT_SUPPORTED)
    const gated = await memberGate(request, deps)
    if (gated instanceof Response) return gated
    const { domain } = deps.validateDomain(new URL(request.url).searchParams.get('domain') ?? '')
    if (!domain) return json(NOT_SUPPORTED)
    const found = await deps.discover(domain, config.providerId).catch(() => null)
    if (!found?.supported) return json(NOT_SUPPORTED)
    const answer: DomainConnectDiscoverResponse = {
      supported: true,
      providerName: found.provider.providerName,
    }
    return json(answer)
  }
}

/** `POST domain-connect/start`: a session, and the signed link to the provider. */
export function createStartRoute(deps: DomainConnectRouteDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return refusal(405, 'Method not allowed', 'method-not-allowed')
    const config = deps.config()
    if (!config) return refusal(404, 'Not found', 'not-configured')
    const gated = await memberGate(request, deps)
    if (gated instanceof Response) return gated
    const { domain, error } = deps.validateDomain(String(gated.body['domain'] ?? ''))
    if (!domain) return refusal(400, error ?? 'Enter a valid domain, for example example.com', 'invalid-domain')

    const found = await deps.discover(domain, config.providerId).catch(() => null)
    if (!found?.supported) {
      return refusal(
        409,
        'This domain’s DNS provider can’t connect it automatically. Add the records above instead.',
        'not-supported',
      )
    }
    const { zone, provider } = found
    // The twin is a name reserved on the site's behalf, so it must be one the
    // platform would let the site hold at all.
    const twin = zone.twin ? deps.validateDomain(zone.twin).domain : null
    // The claim in `connectHostCustomDomain` refuses this too, but only after
    // the owner has been to their provider and changed their DNS for nothing.
    if (await deps.heldElsewhere(twin ? [domain, twin] : [domain], gated.hostId)) {
      return refusal(409, 'That domain is already connected to another site', 'taken')
    }

    const state = deps.newState()
    const id = domainConnectSessionId(state)
    if (!id) return refusal(500, 'Could not start', 'state')
    const session = newDomainConnectSession({
      orgId: gated.site.orgId,
      hostId: gated.hostId,
      domain,
      root: zone.root,
      host: zone.host,
      template: zone.template,
      twin,
      providerId: provider.providerId,
      providerName: provider.providerName,
      serviceId: zone.serviceId,
      createdBy: gated.caller.uid,
      createdByEmail: gated.caller.email,
      nowMs: deps.now(),
    })
    await deps.engine.store.create(id, session)
    const url = buildSignedApplyUrl(
      {
        urlSyncUX: provider.urlSyncUX,
        providerId: config.providerId,
        serviceId: zone.serviceId,
        domain: zone.root,
        host: zone.host,
        redirectUri: config.redirectUri,
        state,
      },
      config.signing,
    )
    const answer: DomainConnectStartResponse = {
      url,
      width: provider.width,
      height: provider.height,
      state,
      providerName: provider.providerName,
    }
    return json(answer)
  }
}

function finishAnswer(session: DomainConnectSession): DomainConnectFinishResponse {
  return {
    status: session.status,
    code: session.code,
    providerName: session.providerName,
    domain: session.domain,
  }
}

/** `POST domain-connect/finish`: check the records, connect when they resolve. */
export function createFinishRoute(deps: DomainConnectRouteDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return refusal(405, 'Method not allowed', 'method-not-allowed')
    if (!deps.config()) return refusal(404, 'Not found', 'not-configured')
    const gated = await memberGate(request, deps)
    if (gated instanceof Response) return gated
    const id = domainConnectSessionId(gated.body['state'])
    if (!id) return refusal(400, 'Missing state', 'invalid-request')
    const session = await deps.engine.store.get(id)
    // Another site's session, or another member's, reads as no session at
    // all: a state is a secret, and an answer must not confirm one exists.
    if (
      !session ||
      session.hostId !== gated.hostId ||
      (session.createdBy !== gated.caller.uid && !gated.caller.staff)
    ) {
      return refusal(404, 'Not found', 'unknown-session')
    }
    const after = await advanceDomainConnectSession(id, deps.engine)
    return json(finishAnswer(after ?? session))
  }
}

/** `GET domain-connect/return`: where the provider sends the browser back. */
export function createReturnRoute(deps: DomainConnectRouteDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return refusal(405, 'Method not allowed', 'method-not-allowed')
    const params = new URL(request.url).searchParams
    const id = domainConnectSessionId(params.get('state'))
    const session = id ? await deps.engine.store.get(id).catch(() => null) : null
    if (!id || !session) return domainConnectReturnPage({ outcome: null, backPath: null })
    const error = (params.get('error') ?? '').trim().slice(0, 64) || null
    const patch = sessionAfterReturn(session, error, deps.now())
    if (patch) await deps.engine.store.update(id, patch).catch(() => undefined)
    const status = patch?.status ?? session.status
    const outcome: DomainConnectReturnMessage['outcome'] =
      status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'applied'
    const backPath = await deps.customDomainPath(session).catch(() => null)
    return domainConnectReturnPage({ outcome, backPath })
  }
}

/**
 * The return door's release subject: the organization its session belongs
 * to, read from the state's hash. No uid — the state proves the browser
 * came back from the provider, not who is holding it.
 */
export function createReturnSubject(deps: Pick<DomainConnectRouteDeps, 'engine'>) {
  return async (request: Request): Promise<{ orgId: string | null } | null> => {
    const id = domainConnectSessionId(new URL(request.url).searchParams.get('state'))
    if (!id) return null
    const session = await deps.engine.store.get(id).catch(() => null)
    return session ? { orgId: session.orgId } : null
  }
}
