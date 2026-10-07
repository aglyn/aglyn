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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { PluginApiRequestSubject } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { SALES_CHANNELS_ENTITLEMENT } from '../../constants/bundle-common'
import { firestore } from '../feed-store'
import { channelsGate, readJsonBody, routeError, routeJson } from '../route-gate'
import { CONNECT_PROVIDERS, readProviderConfig, type ConnectProvider, type ProviderConfig } from './config'
import {
  deleteConnection,
  getConnection,
  openConnectionToken,
  publicConnection,
  saveConnection,
  sealConnectionToken,
  type ConnectionDocument,
} from './connection-store'
import { googleAuthorizeUrl, googleExchangeCode, googleListAccounts, googleRevoke } from './google-merchant'
import { connectRuntime } from './http'
import { metaAuthorizeUrl, metaExchangeCode, metaListCatalogs, metaRevoke } from './meta-catalog'
import {
  connectRedirectUri,
  consoleOriginFor,
  consolePath,
  consumeConnectState,
  mintConnectState,
  type ConnectStateClaims,
  readConnectState,
  recordConnectState,
} from './oauth-state'
import { clearSyncRecord, runSync, SyncBusyError, SyncRefusedError } from './sync'

/**
 * THE CHANNEL CONNECTIONS' ROUTES (AGL-3637, phase 2), served by the console:
 *
 *   POST sales-channels/connect/start       the provider's consent address (admin)
 *   GET  sales-channels/connect/callback    the provider's redirect back (signed state, no bearer)
 *   POST sales-channels/connect/select      the account or catalog to push to (admin)
 *   POST sales-channels/connect/disconnect  forget the grant, revoking it (admin)
 *   POST sales-channels/sync                push the catalog now (editor)
 *
 * Each answers 404 for a provider this deployment has not configured, so an
 * unconfigured connection is not merely hidden in the card but absent.
 */

const CONNECTION_ACTIVITY = (provider: ConnectProvider) =>
  ({
    type: 'sales-channels:connection',
    id: provider,
    name: provider === 'google' ? 'Google Merchant Center' : 'Meta catalog',
  }) as const

const MAX_CODE_CHARS = 2048

const methodNotAllowed = (allow: string) =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow, 'Cache-Control': 'no-store' },
  })

const providerLabel = (provider: ConnectProvider) => (provider === 'google' ? 'Google' : 'Meta')

/** The configured provider a body names, or the refusal. */
function configuredProvider(value: unknown): { provider: ConnectProvider; config: ProviderConfig } | Response {
  const provider = CONNECT_PROVIDERS.find((candidate) => candidate === value)
  if (!provider) return routeError(404, 'Not found')
  const read = readProviderConfig(provider)
  if (!read.configured) return routeError(404, 'Not found')
  return { provider, config: read.config }
}

export async function connectStartRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const picked = configuredProvider(body['provider'])
  if (picked instanceof Response) return picked
  const actor = await channelsGate(request, { role: 'admin', body })
  if (actor instanceof Response) return actor
  const origin = consoleOriginFor(request.url)
  const redirectUri = connectRedirectUri(request.url)
  if (!origin || !redirectUri) return routeError(503, 'This console has no address to come back to.')
  const returnTo = consolePath(body['returnTo'], origin)
  if (!returnTo) return routeError(400, 'Connect from the console.')
  const nowMs = connectRuntime.now()
  let minted
  try {
    minted = mintConnectState({
      hostId: actor.hostId,
      orgId: actor.orgId,
      uid: actor.uid,
      provider: picked.provider,
      returnTo,
      nowMs,
    })
  } catch {
    return routeError(503, 'Connections are not set up on this deployment yet.')
  }
  await recordConnectState({ claims: minted.claims, redirectUri, nowMs })
  const authorizeUrl =
    picked.provider === 'google'
      ? googleAuthorizeUrl(picked.config, { state: minted.state, redirectUri })
      : metaAuthorizeUrl(picked.config, { state: minted.state, redirectUri })
  return routeJson({ authorizeUrl })
}

/** The organization and member a provider's redirect is for, read off the signed state. */
export function connectCallbackSubject(request: Request): PluginApiRequestSubject | null {
  const read = readConnectState(new URL(request.url).searchParams.get('state'), connectRuntime.now())
  if (read.ok) return { orgId: read.claims.orgId, uid: read.claims.uid }
  if (read.ok === false && read.refusal === 'state-expired') {
    const { claims } = read as { claims: { orgId: string; uid: string } }
    return { orgId: claims.orgId, uid: claims.uid }
  }
  return null
}

const ROLE_RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }

/** Whether the member who started the connect may still finish it: admin, and a plan that sells. */
async function mayStillConnect(hostId: string, uid: string): Promise<boolean> {
  const [hostSnapshot, resolved] = await Promise.all([
    firestore().collection('hosts').doc(hostId).get(),
    getOrgForHost(hostId),
  ])
  if (!hostSnapshot.exists || !resolved) return false
  if (!checkEntitlement(resolved.org as never, SALES_CHANNELS_ENTITLEMENT)) return false
  const roles = (hostSnapshot.data()?.['memberRoles'] ?? {}) as Record<string, unknown>
  if ((ROLE_RANK[String(roles[uid] ?? '')] ?? 0) >= ROLE_RANK['admin']) return true
  try {
    const user = await firebaseAdmin.app().auth().getUser(uid)
    return user.customClaims?.['staff'] === true
  } catch {
    return false
  }
}

const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })

/** Back to the console page the connect started on, with what happened. */
function backTo(returnTo: string, provider: ConnectProvider, outcome: string): Response {
  const url = new URL(returnTo, 'https://console.invalid')
  url.searchParams.delete('salesChannelsConnect')
  url.searchParams.delete('salesChannelsProvider')
  url.searchParams.set('salesChannelsProvider', provider)
  url.searchParams.set('salesChannelsConnect', outcome)
  return new Response(null, {
    status: 303,
    headers: {
      // A RELATIVE location: the callback's own origin, which is the console's.
      Location: `${url.pathname}${url.search}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

export async function connectCallbackRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const params = new URL(request.url).searchParams
  const nowMs = connectRuntime.now()
  const read = readConnectState(params.get('state'), nowMs)
  if (read.ok === false && read.refusal === 'state-invalid') {
    return plain(400, 'This connection link is not valid. Return to the console and connect again.')
  }
  const claims = (read as { claims: ConnectStateClaims }).claims
  const origin = consoleOriginFor(request.url)
  const returnTo = origin ? consolePath(claims.returnTo, origin) : null
  if (!returnTo) return plain(400, 'This connection link is not valid. Return to the console and connect again.')
  const picked = configuredProvider(claims.provider)
  if (picked instanceof Response) return picked
  const { provider, config } = picked
  if (!read.ok) return backTo(returnTo, provider, 'expired')
  const consumed = await consumeConnectState({ claims, nowMs })
  if (!consumed.ok) return backTo(returnTo, provider, 'expired')
  if (params.get('error')) return backTo(returnTo, provider, 'denied')
  const code = params.get('code') ?? ''
  if (!code || code.length > MAX_CODE_CHARS) return backTo(returnTo, provider, 'failed')
  if (!(await mayStillConnect(claims.hostId, claims.uid))) return backTo(returnTo, provider, 'not-permitted')

  try {
    let token: string
    let tokenExpiresAtMs: number | null = null
    let targets: Array<{ id: string; name: string }>
    if (provider === 'google') {
      const exchanged = await googleExchangeCode(config, { code, redirectUri: consumed.redirectUri })
      token = exchanged.refreshToken
      targets = await googleListAccounts(exchanged.accessToken)
    } else {
      const exchanged = await metaExchangeCode(config, { code, redirectUri: consumed.redirectUri, nowMs })
      token = exchanged.accessToken
      tokenExpiresAtMs = exchanged.expiresAtMs
      targets = await metaListCatalogs(config, token)
    }
    const held = await getConnection(claims.hostId, provider)
    const kept = held && targets.some((target) => target.id === held.targetId) ? held : null
    const target = kept ? { id: kept.targetId, name: kept.targetName } : (targets[0] ?? { id: '', name: '' })
    const connection: ConnectionDocument = {
      provider,
      sealedToken: sealConnectionToken(token, config.keyring, claims.hostId, provider),
      targetId: target.id,
      targetName: target.name,
      targets,
      connectedAtMs: nowMs,
      connectedBy: claims.uid,
      ...(tokenExpiresAtMs ? { tokenExpiresAtMs } : {}),
      ...(kept?.scheduledFeedId ? { scheduledFeedId: kept.scheduledFeedId } : {}),
      ...(kept?.lastSyncAtMs ? { lastSyncAtMs: kept.lastSyncAtMs } : {}),
      ...(kept?.lastSyncResult ? { lastSyncResult: kept.lastSyncResult } : {}),
    }
    await saveConnection(claims.hostId, connection)
    if (!kept) await clearSyncRecord(claims.hostId, provider)
    await logHostActivity(claims.hostId, { uid: claims.uid }, `Connected ${providerLabel(provider)} for product sync`, CONNECTION_ACTIVITY(provider))
    return backTo(returnTo, provider, targets.length ? 'connected' : 'no-targets')
  } catch (error) {
    console.error('sales-channels: connect callback failed', error)
    return backTo(returnTo, provider, 'failed')
  }
}

/** The connection a body names, behind the gate and the configuration. */
async function connectionRoute(
  request: Request,
  role: 'editor' | 'admin',
): Promise<
  | Response
  | {
      body: Record<string, unknown>
      actor: Exclude<Awaited<ReturnType<typeof channelsGate>>, Response>
      provider: ConnectProvider
      config: ProviderConfig
      connection: ConnectionDocument
    }
> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const picked = configuredProvider(body['provider'])
  if (picked instanceof Response) return picked
  const actor = await channelsGate(request, { role, body })
  if (actor instanceof Response) return actor
  const connection = await getConnection(actor.hostId, picked.provider)
  if (!connection) return routeError(409, `${providerLabel(picked.provider)} is not connected.`)
  return { body, actor, provider: picked.provider, config: picked.config, connection }
}

export async function connectSelectRoute(request: Request): Promise<Response> {
  const resolved = await connectionRoute(request, 'admin')
  if (resolved instanceof Response) return resolved
  const { body, actor, provider, connection } = resolved
  const target = connection.targets.find((candidate) => candidate.id === String(body['targetId'] ?? ''))
  if (!target) {
    return routeError(400, provider === 'google' ? 'That account is not one this connection reaches.' : 'That catalog is not one this connection reaches.')
  }
  if (target.id !== connection.targetId) {
    // A new account gets its own data source, and starts with nothing sent.
    const next: ConnectionDocument = { ...connection, targetId: target.id, targetName: target.name }
    delete next.scheduledFeedId
    await saveConnection(actor.hostId, next)
    await clearSyncRecord(actor.hostId, provider)
  }
  return routeJson({ connection: publicConnection(await getConnection(actor.hostId, provider)) })
}

export async function disconnectRoute(request: Request): Promise<Response> {
  const resolved = await connectionRoute(request, 'admin')
  if (resolved instanceof Response) return resolved
  const { actor, provider, config, connection } = resolved
  try {
    const token = openConnectionToken(connection, config.keyring, actor.hostId)
    await (provider === 'google' ? googleRevoke(token) : metaRevoke(config, token))
  } catch (error) {
    // A grant that cannot be revoked is still forgotten here; the member can remove the app on the provider's side.
    console.warn('sales-channels: revoke failed', error)
  }
  await deleteConnection(actor.hostId, provider)
  await clearSyncRecord(actor.hostId, provider)
  await logHostActivity(actor.hostId, { uid: actor.uid }, `Disconnected ${providerLabel(provider)} product sync`, CONNECTION_ACTIVITY(provider))
  return routeJson({ connection: null })
}

export async function syncRoute(request: Request): Promise<Response> {
  const resolved = await connectionRoute(request, 'editor')
  if (resolved instanceof Response) return resolved
  const { actor, config, connection } = resolved
  try {
    const result = await runSync({ hostId: actor.hostId, uid: actor.uid, config, connection })
    return routeJson({ result, connection: publicConnection(await getConnection(actor.hostId, connection.provider)) })
  } catch (error) {
    if (error instanceof SyncBusyError) return routeError(409, error.message)
    if (error instanceof SyncRefusedError) return routeError(409, error.message)
    console.error('sales-channels: sync failed', error)
    return routeError(500, 'The sync could not run. Try again.')
  }
}
