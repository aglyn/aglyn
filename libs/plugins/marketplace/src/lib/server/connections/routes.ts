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

import { holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  isPluginConnectionChoiceId,
  pluginConnectionAuthorizeUrl,
  type PluginConnectionDeclaration,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import type { PluginApiRequestSubject } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import {
  PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION,
  PLUGIN_CONNECTIONS_FEATURE,
  PLUGIN_CONNECTIONS_PLAN_REFUSAL,
  PLUGIN_CONNECTIONS_SITE_PERMISSION,
  PLUGIN_CONNECTIONS_SITE_ROLE_PRESET,
  pluginConnectionsPermissionRefusal,
  type PluginConnectionCredentialsStatus,
  type PluginConnectionStatusEntry,
} from '../../model/plugin-connections'
import { publisherPermissionVerdict } from '../publisher-permissions'
import { isHostId, isListingId, readPluginConnectionsKeyring } from './config'
import {
  connectionAccessToken,
  connectionReady,
  connectionRef,
  getConnection,
  listHostConnections,
  newConnectionRecord,
  PluginConnectionReconnectRequiredError,
  toConnectionView,
  type PluginConnectionRecord,
} from './connection-store'
import { clearCredentials, credentialsStatus, openCredentials, saveCredentials, sealCredentials } from './credentials-store'
import {
  installedConnection,
  installedConnectionsForHost,
  latestListingConnections,
} from './installed-connection'
import {
  connectRedirectUri,
  consoleOriginFor,
  consolePath,
  consumeConnectState,
  mintConnectState,
  readConnectState,
  recordConnectState,
  type ConnectStateClaims,
} from './oauth-state'
import {
  exchangePluginConnectionCode,
  listPluginConnectionResource,
  pluginConnectionRuntime,
  PluginConnectionProviderError,
  type PluginConnectionClient,
} from './provider-http'
import { revokeRecord } from './revoke'

/**
 * THE DECLARED CONNECTIONS' ROUTES (AGL-4193), served by the console for every
 * marketplace plugin that declares a connection:
 *
 *   GET|POST plugin-connections/connect/start     the provider's consent address   (site key, plan)
 *   GET      plugin-connections/connect/callback  the provider's redirect back      (signed state, no bearer)
 *   GET      plugin-connections/resources         what the grant reaches, to pick   (site key, plan)
 *   POST     plugin-connections/choose            the resource the site reads       (site key, plan)
 *   POST     plugin-connections/disconnect        revoke and forget the grant       (site key, any plan)
 *   GET      plugin-connections/status            each declared connection, no token (site key)
 *   GET|POST plugin-connections/credentials       the listing's OAuth app, write-only (publisher key)
 *
 * The site key is "Manage a site's plugin connections"
 * (`marketplace.siteConnections`) and the publisher key "Set a listing's
 * connection credentials" (`marketplace.connectionCredentials`); a refusal
 * names the permission, never a role. The callback path is registered as a
 * redirect URI at providers and must never move.
 *
 * Without `PLUGIN_CONNECTIONS_TOKEN_KEY` every route that would seal or open a
 * secret answers 503, and status says `configured: false`.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_CODE_CHARS = 4096
const CLIENT_ID_PATTERN = /^[\x21-\x7e]{1,512}$/
const CLIENT_SECRET_PATTERN = /^[\x21-\x7e]{1,1024}$/
const NOT_CONFIGURED = 'Plugin connections are not set up on this deployment yet.'

const firestore = (): FirebaseFirestore.Firestore => firebaseAdmin.app().firestore()

export function routeJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function routeError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: NO_STORE })
}

const methodNotAllowed = (allow: string) =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow, ...NO_STORE },
  })

/** The request's parameters: the query for a GET, the JSON body (over the query) for a POST. */
async function readParams(request: Request): Promise<Record<string, unknown>> {
  const query = Object.fromEntries(new URL(request.url).searchParams.entries())
  if (request.method === 'GET' || request.method === 'HEAD') return query
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? { ...query, ...(body as Record<string, unknown>) } : query
}

/** The signed-in member, or the refusal. */
async function signedIn(request: Request): Promise<{ uid: string; staff: boolean } | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return routeError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    // Only a token the verifier refused is the caller's fault; a certificate
    // fetch that failed is ours, and must not read as a bad sign-in.
    if (isRefusedIdToken(error)) return routeError(401, 'Unauthenticated')
    console.error('plugin-connections: the sign-in could not be checked', error)
    return routeError(503, 'The sign-in could not be checked. Try again.')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return routeError(403, 'Verify your email address first')
  }
  return { uid: decoded.uid, staff: decoded['staff'] === true }
}

/** Whether `uid` holds "Manage a site's plugin connections" on the site. */
export function holdsSiteConnectionsKey(host: Record<string, unknown>, uid: string): boolean {
  return holdsStampedSiteKey(host, uid, PLUGIN_CONNECTIONS_SITE_PERMISSION, PLUGIN_CONNECTIONS_SITE_ROLE_PRESET)
}

export interface SiteActor {
  uid: string
  hostId: string
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
  planAllows: boolean
}

/**
 * THE GATE EVERY SITE ROUTE CLIMBS. The console's dispatcher has already
 * refused a site with the marketplace switched off or unreleased, a lockdown
 * and a caller over the write limit. What it cannot know is the member, the
 * key and the plan:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  an unverified address (an impersonation session is exempt)
 *   400  no site named
 *   404  no such site
 *   403  without "Manage a site's plugin connections" on the site — held by
 *        the member themselves: the grant is the business's own account at
 *        the provider, so staff support does not connect one
 *   403  a plan without connections, when the route asks for it
 */
export async function siteConnectionsGate(
  request: Request,
  params: Record<string, unknown>,
  options: { requirePlan: boolean },
): Promise<SiteActor | Response> {
  const caller = await signedIn(request)
  if (caller instanceof Response) return caller
  const hostId = params['hostId']
  if (!isHostId(hostId)) return routeError(400, 'Missing hostId')
  const [hostSnapshot, resolved] = await Promise.all([firestore().collection('hosts').doc(hostId).get(), getOrgForHost(hostId)])
  if (!hostSnapshot.exists || !resolved) return routeError(404, 'Site not found')
  const host = hostSnapshot.data() ?? {}
  if (!holdsSiteConnectionsKey(host, caller.uid)) {
    return routeError(403, pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_SITE_PERMISSION), {
      reason: 'permission',
      permission: PLUGIN_CONNECTIONS_SITE_PERMISSION,
    })
  }
  const planAllows = checkEntitlement(resolved.org as never, PLUGIN_CONNECTIONS_FEATURE)
  if (options.requirePlan && !planAllows) {
    return routeError(403, PLUGIN_CONNECTIONS_PLAN_REFUSAL, { reason: 'plan', feature: PLUGIN_CONNECTIONS_FEATURE })
  }
  return { uid: caller.uid, hostId, orgId: resolved.orgId, org: resolved.org as Record<string, unknown>, host, planAllows }
}

/** The keyring, or the 503 that says connections are not set up. */
function keyringOr503(): SecretBoxKeyring | Response {
  return readPluginConnectionsKeyring() ?? routeError(503, NOT_CONFIGURED)
}

/** The declared connection a request names on the actor's site, with the publisher's app, or the refusal. */
async function resolveConnection(
  actor: SiteActor,
  params: Record<string, unknown>,
  keyring: SecretBoxKeyring,
): Promise<
  | Response
  | {
      listingId: string
      displayName: string
      connection: PluginConnectionDeclaration
      client: PluginConnectionClient
    }
> {
  const listingId = params['listingId']
  const connectionId = params['connectionId']
  if (!isListingId(listingId) || typeof connectionId !== 'string' || !connectionId) {
    return routeError(400, 'Missing listingId or connectionId')
  }
  const found = await installedConnection(firestore(), { hostId: actor.hostId, orgId: actor.orgId, listingId, connectionId })
  if (!found) return routeError(404, 'This site runs no plugin that declares that connection.')
  let client: PluginConnectionClient | null
  try {
    client = await openCredentials(firestore(), keyring, listingId, connectionId)
  } catch (error) {
    console.error('plugin-connections: a listing’s credentials did not open', error)
    client = null
  }
  if (!client) {
    return routeError(409, 'The plugin’s publisher has not finished setting up this connection yet.', { reason: 'credentials' })
  }
  return { listingId, displayName: found.installed.displayName, connection: found.connection, client }
}

const activityTarget = (connection: PluginConnectionDeclaration, listingId: string) =>
  ({ type: 'marketplace:plugin-connection', id: `${listingId}/${connection.id}`, name: connection.label }) as const

/* ------------------------------------------------------------------ */
/* Connect                                                              */
/* ------------------------------------------------------------------ */

export async function connectStartRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST')
  const params = await readParams(request)
  const actor = await siteConnectionsGate(request, params, { requirePlan: true })
  if (actor instanceof Response) return actor
  const keyring = keyringOr503()
  if (keyring instanceof Response) return keyring
  const resolved = await resolveConnection(actor, params, keyring)
  if (resolved instanceof Response) return resolved
  const origin = consoleOriginFor(request.url)
  const redirectUri = connectRedirectUri(request.url)
  if (!origin || !redirectUri) return routeError(503, 'This console has no address to come back to.')
  const returnTo = consolePath(params['returnTo'], origin)
  if (!returnTo) return routeError(400, 'Connect from the console.')
  const nowMs = pluginConnectionRuntime.now()
  let minted
  try {
    minted = mintConnectState({
      hostId: actor.hostId,
      orgId: actor.orgId,
      uid: actor.uid,
      listingId: resolved.listingId,
      connectionId: resolved.connection.id,
      returnTo,
      nowMs,
    })
  } catch {
    return routeError(503, NOT_CONFIGURED)
  }
  await recordConnectState(firestore(), { claims: minted.claims, redirectUri, nowMs })
  return routeJson({
    authorizeUrl: pluginConnectionAuthorizeUrl(resolved.connection, {
      clientId: resolved.client.clientId,
      redirectUri,
      state: minted.state,
    }),
  })
}

/** The workspace and member a provider's redirect is for, read off the signed state. */
export function connectCallbackSubject(request: Request): PluginApiRequestSubject | null {
  const read = readConnectState(new URL(request.url).searchParams.get('state'), pluginConnectionRuntime.now())
  if (read.ok) return { orgId: read.claims.orgId, uid: read.claims.uid }
  if (read.ok === false && read.refusal === 'state-expired') {
    const { claims } = read as { claims: ConnectStateClaims }
    return { orgId: claims.orgId, uid: claims.uid }
  }
  return null
}

/**
 * Whether the member who started the connect may still finish it: the site
 * still in the same workspace, on a plan with connections, and the member
 * still holding the key.
 */
async function mayStillConnect(claims: ConnectStateClaims): Promise<SiteActor | null> {
  const [hostSnapshot, resolved] = await Promise.all([
    firestore().collection('hosts').doc(claims.hostId).get(),
    getOrgForHost(claims.hostId),
  ])
  if (!hostSnapshot.exists || !resolved || resolved.orgId !== claims.orgId) return null
  const host = hostSnapshot.data() ?? {}
  if (!holdsSiteConnectionsKey(host, claims.uid)) return null
  if (!checkEntitlement(resolved.org as never, PLUGIN_CONNECTIONS_FEATURE)) return null
  return {
    uid: claims.uid,
    hostId: claims.hostId,
    orgId: resolved.orgId,
    org: resolved.org as Record<string, unknown>,
    host,
    planAllows: true,
  }
}

const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer', ...NO_STORE },
  })

/** Back to the console page the connect started on, with what happened. */
function backTo(returnTo: string, claims: Pick<ConnectStateClaims, 'listingId' | 'connectionId'>, outcome: string): Response {
  const url = new URL(returnTo, 'https://console.invalid')
  url.searchParams.set('pluginConnectionListing', claims.listingId)
  url.searchParams.set('pluginConnection', claims.connectionId)
  url.searchParams.set('pluginConnectionResult', outcome)
  return new Response(null, {
    status: 303,
    headers: {
      // A RELATIVE location: the callback's own origin, which is the console's.
      Location: `${url.pathname}${url.search}`,
      'Referrer-Policy': 'no-referrer',
      ...NO_STORE,
    },
  })
}

export async function connectCallbackRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const params = new URL(request.url).searchParams
  const nowMs = pluginConnectionRuntime.now()
  const read = readConnectState(params.get('state'), nowMs)
  if (read.ok === false && read.refusal === 'state-invalid') {
    return plain(400, 'This connection link is not valid. Return to the console and connect again.')
  }
  const claims = (read as { claims: ConnectStateClaims }).claims
  const origin = consoleOriginFor(request.url)
  const returnTo = origin ? consolePath(claims.returnTo, origin) : null
  if (!returnTo) return plain(400, 'This connection link is not valid. Return to the console and connect again.')
  if (read.ok === false) return backTo(returnTo, claims, 'expired')
  const consumed = await consumeConnectState(firestore(), { claims, nowMs })
  if (consumed.ok === false) return backTo(returnTo, claims, 'expired')
  if (params.get('error')) return backTo(returnTo, claims, 'denied')
  const code = params.get('code') ?? ''
  if (!code || code.length > MAX_CODE_CHARS) return backTo(returnTo, claims, 'failed')
  const actor = await mayStillConnect(claims)
  if (!actor) return backTo(returnTo, claims, 'not-permitted')
  const keyring = readPluginConnectionsKeyring()
  if (!keyring) return backTo(returnTo, claims, 'failed')
  const resolved = await resolveConnection(actor, claims as unknown as Record<string, unknown>, keyring)
  if (resolved instanceof Response) return backTo(returnTo, claims, resolved.status === 409 ? 'not-set-up' : 'failed')

  try {
    const tokens = await exchangePluginConnectionCode(resolved.connection, resolved.client, {
      code,
      redirectUri: (consumed as { redirectUri: string }).redirectUri,
    })
    const previous = await getConnection(firestore(), actor.hostId, resolved.listingId, resolved.connection.id)
    const record = newConnectionRecord({
      keyring,
      hostId: actor.hostId,
      orgId: actor.orgId,
      listingId: resolved.listingId,
      connection: resolved.connection,
      tokens,
      uid: actor.uid,
      nowMs,
      previous,
    })
    await connectionRef(firestore(), actor.hostId, resolved.listingId, resolved.connection.id).set(record)
    await logHostActivity(
      actor.hostId,
      { uid: actor.uid },
      `Connected ${resolved.connection.label} for ${resolved.displayName}`,
      activityTarget(resolved.connection, resolved.listingId),
    )
    return backTo(returnTo, claims, 'connected')
  } catch (error) {
    console.error('plugin-connections: connect callback failed', error instanceof Error ? error.message : error)
    return backTo(returnTo, claims, 'failed')
  }
}

/* ------------------------------------------------------------------ */
/* Resources                                                            */
/* ------------------------------------------------------------------ */

/** The site's connection behind the gate, the plan, the key and the declaration. */
async function connectedRoute(
  request: Request,
  method: 'GET' | 'POST',
): Promise<
  | Response
  | {
      params: Record<string, unknown>
      actor: SiteActor
      keyring: SecretBoxKeyring
      listingId: string
      connection: PluginConnectionDeclaration
      client: PluginConnectionClient
      record: PluginConnectionRecord
    }
> {
  if (request.method !== method) return methodNotAllowed(method)
  const params = await readParams(request)
  const actor = await siteConnectionsGate(request, params, { requirePlan: true })
  if (actor instanceof Response) return actor
  const keyring = keyringOr503()
  if (keyring instanceof Response) return keyring
  const resolved = await resolveConnection(actor, params, keyring)
  if (resolved instanceof Response) return resolved
  const record = await getConnection(firestore(), actor.hostId, resolved.listingId, resolved.connection.id)
  if (!record) return routeError(409, `${resolved.connection.label} is not connected.`, { reason: 'not-connected' })
  if (record.status === 'reconnect_required') {
    return routeError(409, `${resolved.connection.label} needs to be connected again.`, { reason: 'reconnect' })
  }
  return { params, actor, keyring, listingId: resolved.listingId, connection: resolved.connection, client: resolved.client, record }
}

/** A resource's items, refreshing the token once on a refusal. */
async function listResource(
  context: Exclude<Awaited<ReturnType<typeof connectedRoute>>, Response>,
  resourceId: string,
): Promise<{ items: Array<{ id: string; label: string }> } | Response> {
  const { connection, record } = context
  const index = (connection.resources ?? []).findIndex((resource) => resource.id === resourceId)
  if (index < 0) return routeError(404, 'That connection declares no such resource.')
  const resource = (connection.resources ?? [])[index]
  const earlier = (connection.resources ?? []).slice(0, index)
  const missing = earlier.find((one) => !record.choices[one.id])
  if (missing) return routeError(409, `Choose the ${missing.label.toLowerCase()} first.`, { reason: 'choose-first', resource: missing.id })
  const choices = Object.fromEntries(earlier.map((one) => [one.id, record.choices[one.id].id]))
  const deps = {
    firestore: firestore(),
    keyring: context.keyring,
    connection,
    client: context.client,
    now: pluginConnectionRuntime.now,
    sleep: pluginConnectionRuntime.sleep,
  }
  try {
    let accessToken = await connectionAccessToken(deps, record)
    try {
      return { items: await listPluginConnectionResource(connection, resource, { accessToken, choices }) }
    } catch (error) {
      if (!(error instanceof PluginConnectionProviderError) || error.code !== 'auth') throw error
      accessToken = await connectionAccessToken(deps, record, { force: true })
      return { items: await listPluginConnectionResource(connection, resource, { accessToken, choices }) }
    }
  } catch (error) {
    if (error instanceof PluginConnectionReconnectRequiredError) {
      return routeError(409, `${connection.label} needs to be connected again.`, { reason: 'reconnect' })
    }
    if (error instanceof PluginConnectionProviderError) {
      return routeError(502, `${connection.label} did not answer: ${error.message}`, { reason: 'provider' })
    }
    throw error
  }
}

export async function resourcesRoute(request: Request): Promise<Response> {
  const context = await connectedRoute(request, 'GET')
  if (context instanceof Response) return context
  const listed = await listResource(context, String(context.params['resource'] ?? ''))
  return listed instanceof Response ? listed : routeJson(listed)
}

export async function chooseRoute(request: Request): Promise<Response> {
  const context = await connectedRoute(request, 'POST')
  if (context instanceof Response) return context
  const { params, actor, connection, record, listingId } = context
  const resourceId = String(params['resource'] ?? '')
  const id = params['id']
  if (!isPluginConnectionChoiceId(id)) return routeError(400, 'Choose one of the listed items.')
  // Re-read what the grant reaches: a choice is only ever one the provider listed.
  const listed = await listResource(context, resourceId)
  if (listed instanceof Response) return listed
  const choice = listed.items.find((item) => item.id === id)
  if (!choice) return routeError(400, 'That is not one this connection reaches.')
  const resources = connection.resources ?? []
  const index = resources.findIndex((resource) => resource.id === resourceId)
  // A new choice clears every later one: a location belongs to its account.
  const choices = { ...record.choices, [resourceId]: choice }
  if (record.choices[resourceId]?.id !== choice.id) {
    for (const later of resources.slice(index + 1)) delete choices[later.id]
  }
  const nowMs = pluginConnectionRuntime.now()
  const ready = connectionReady({ choices }, connection)
  await connectionRef(firestore(), actor.hostId, listingId, connection.id).update({
    choices,
    nextSyncAtMs: ready ? nowMs : null,
    updatedAtMs: nowMs,
  })
  const next = await getConnection(firestore(), actor.hostId, listingId, connection.id)
  return routeJson({ connection: next ? toConnectionView(next, connection) : null })
}

/* ------------------------------------------------------------------ */
/* Disconnect and status                                                */
/* ------------------------------------------------------------------ */

export async function disconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const params = await readParams(request)
  // Any plan: a workspace that moved to Free must still be able to let go.
  const actor = await siteConnectionsGate(request, params, { requirePlan: false })
  if (actor instanceof Response) return actor
  const listingId = params['listingId']
  const connectionId = params['connectionId']
  if (!isListingId(listingId) || typeof connectionId !== 'string' || !connectionId) {
    return routeError(400, 'Missing listingId or connectionId')
  }
  const record = await getConnection(firestore(), actor.hostId, listingId, connectionId)
  if (!record) return routeJson({ connection: null })
  const revoked = await revokeRecord(record, actor.orgId)
  await connectionRef(firestore(), actor.hostId, listingId, connectionId).delete()
  await logHostActivity(actor.hostId, { uid: actor.uid }, `Disconnected a plugin connection (${record.provider})`, {
    type: 'marketplace:plugin-connection',
    id: `${listingId}/${connectionId}`,
  })
  return routeJson({ connection: null, revoked })
}

export async function statusRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const params = await readParams(request)
  const actor = await siteConnectionsGate(request, params, { requirePlan: false })
  if (actor instanceof Response) return actor
  const onlyListing = isListingId(params['listingId']) ? params['listingId'] : null
  const [installed, records] = await Promise.all([
    installedConnectionsForHost(firestore(), { hostId: actor.hostId, orgId: actor.orgId }),
    listHostConnections(firestore(), actor.hostId),
  ])
  const entries: PluginConnectionStatusEntry[] = []
  for (const plugin of installed) {
    if (onlyListing && plugin.listingId !== onlyListing) continue
    const set = await credentialsStatus(
      firestore(),
      plugin.listingId,
      plugin.connections.map((connection) => connection.id),
    )
    for (const connection of plugin.connections) {
      const record = records.find((one) => one.listingId === plugin.listingId && one.connectionId === connection.id)
      entries.push({
        listingId: plugin.listingId,
        connectionId: connection.id,
        provider: connection.provider,
        label: connection.label,
        ...(connection.description ? { description: connection.description } : {}),
        resources: (connection.resources ?? []).map((resource) => ({ id: resource.id, label: resource.label })),
        connection: record ? toConnectionView(record, connection) : null,
        credentialsSet: set[connection.id]?.set ?? false,
        planAllows: actor.planAllows,
      })
    }
  }
  return routeJson({ configured: Boolean(readPluginConnectionsKeyring()), planAllows: actor.planAllows, connections: entries })
}

/* ------------------------------------------------------------------ */
/* The publisher's OAuth app                                            */
/* ------------------------------------------------------------------ */

/**
 * GET: whether each connection the listing's latest version declares has its
 * OAuth app set. POST `{ listingId, connectionId, clientId, clientSecret }`
 * sets or replaces the pair; `{ listingId, connectionId, clear: true }`
 * removes it. Never answers either value. Asks "Set a listing's connection
 * credentials" of a member of the workspace that published the listing.
 */
export async function credentialsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST')
  const params = await readParams(request)
  const caller = await signedIn(request)
  if (caller instanceof Response) return caller
  const listingId = params['listingId']
  if (!isListingId(listingId)) return routeError(400, 'Missing listingId')
  const listing = await firestore().collection('marketplaceListings').doc(listingId).get()
  if (!listing.exists || listing.get('deletedAt')) return routeError(404, 'Unknown listing')
  const publisherOrgId = listing.get('profileId')
  // The key spelled out (`PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION`), so the
  // repo's enforcement guard finds the door that asks it.
  const verdict = await publisherPermissionVerdict(
    caller.uid,
    typeof publisherOrgId === 'string' ? publisherOrgId : null,
    'marketplace.connectionCredentials',
  )
  if (verdict === 'not-a-member') return routeError(403, 'Not your listing')
  if (verdict === 'refused') {
    return routeError(403, pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION), {
      reason: 'permission',
      permission: PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION,
    })
  }
  const declared = await latestListingConnections(firestore(), listingId, String(listing.get('latestVersion') ?? ''))
  const answer = async (): Promise<Response> => {
    const set = await credentialsStatus(firestore(), listingId, declared.map((connection) => connection.id))
    const credentials: PluginConnectionCredentialsStatus[] = declared.map((connection) => ({
      connectionId: connection.id,
      label: connection.label,
      set: set[connection.id]?.set ?? false,
      updatedAtMs: set[connection.id]?.updatedAtMs ?? null,
    }))
    return routeJson({ configured: Boolean(readPluginConnectionsKeyring()), credentials })
  }
  if (request.method === 'GET') return answer()

  const connection = declared.find((one) => one.id === params['connectionId'])
  if (!connection) return routeError(404, 'The listing’s latest version declares no such connection.')
  if (params['clear'] === true) {
    await clearCredentials(firestore(), listingId, connection.id)
    return answer()
  }
  const clientId = typeof params['clientId'] === 'string' ? params['clientId'].trim() : ''
  const clientSecret = typeof params['clientSecret'] === 'string' ? params['clientSecret'].trim() : ''
  if (!CLIENT_ID_PATTERN.test(clientId) || !CLIENT_SECRET_PATTERN.test(clientSecret)) {
    return routeError(400, 'Enter the OAuth app’s client id and client secret.')
  }
  const keyring = keyringOr503()
  if (keyring instanceof Response) return keyring
  await saveCredentials(
    firestore(),
    sealCredentials(keyring, {
      orgId: String(publisherOrgId),
      listingId,
      connectionId: connection.id,
      clientId,
      clientSecret,
      uid: caller.uid,
      nowMs: pluginConnectionRuntime.now(),
    }),
  )
  return answer()
}
