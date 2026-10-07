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
 * THE ACCOUNTING PAGE'S ROUTES (AGL-3614): connect, choose the accounts,
 * read the sync log, retry, disconnect.
 *
 * Every route but the OAuth callback climbs {@link accountingMemberGate}.
 * The callback carries no bearer token — it is a browser arriving back from
 * Intuit or Xero — so it acts on nothing: it verifies the signed state and
 * hands the code to the Accounting page in a URL fragment, and the page
 * finishes the connect with the member's own session
 * (`accounting/connect/complete`), where the state is checked against that
 * member and consumed once.
 */

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { ACCOUNTING_API_ROUTES } from '../constants/api-routes'
import { validateAccountingMapping } from '../model/accounting-mapping'
import { dateInZone } from '../model/accounting-money'
import {
  ACCOUNTING_PROVIDERS,
  ACCOUNTING_PROVIDER_LABELS,
  buildAccountingConnectFragment,
  isAccountingProviderId,
  type AccountingConnectReturn,
  type AccountingLogResponse,
  type AccountingOptionsResponse,
  type AccountingProviderId,
  type AccountingStatusResponse,
} from '../model/accounting.types'
import { accountingMemberGate, refusal, type AccountingGateContext, type AccountingGateDeps } from './accounting-gate'
import { accountingNotConfiguredMessage, type AccountingProviderConfigResult } from './accounting-config'
import { startBackfill } from './backfill'
import {
  connectionRef,
  connectionSession,
  loadOrgConnection,
  newConnectionRecord,
  openToken,
  toConnectionView,
  type AccountingConnectionRecord,
} from './connection-store'
import {
  consumeAccountingOAuthState,
  mintAccountingOAuthState,
  readAccountingOAuthState,
  recordAccountingOAuthState,
} from './oauth-state'
import { AccountingProviderError } from './providers/http'
import type { AccountingProvider, AccountingSession } from './providers/provider'
import { syncCounts } from './sync-engine'
import { readSyncItem, syncItemsCollection, toSyncItemView } from './sync-store'

export interface AccountingRouteDeps {
  firestore: () => FirebaseFirestore.Firestore
  gate: AccountingGateDeps
  readProviderConfig: (provider: AccountingProviderId) => AccountingProviderConfigResult
  /** The adapter, or `null` when the provider is not configured here. */
  providerFor: (provider: AccountingProviderId) => AccountingProvider | null
  stateSigningConfigured: () => boolean
  redirectUri: (requestUrl: string) => string | null
  now: () => number
  logOrgActivity(
    orgId: string,
    actor: { uid: string; email?: string | null },
    action: string,
    target: { type: typeof ACCOUNTING_ACTIVITY_TARGET; id: string; name: string },
  ): Promise<void>
}

export interface AccountingRoutes {
  status: PluginWebApiHandler
  connect: PluginWebApiHandler
  oauthCallback: PluginWebApiHandler
  connectComplete: PluginWebApiHandler
  selectTenant: PluginWebApiHandler
  options: PluginWebApiHandler
  settings: PluginWebApiHandler
  log: PluginWebApiHandler
  retry: PluginWebApiHandler
  disconnect: PluginWebApiHandler
}

/** The org activity target the connection's rows are filed under. */
export const ACCOUNTING_ACTIVITY_TARGET = 'accounting:connection'

/** Where the callback sends the member back to: the Connection section. */
export const ACCOUNTING_CONNECTION_SECTION_PATH = 'accounting/connection'

const noStore = { 'Cache-Control': 'no-store' }
const ok = (body: unknown) => Response.json(body, { status: 200, headers: noStore })
const MAX_CODE_CHARS = 4096
const ITEM_ID = /^[A-Za-z0-9_-]{1,1400}$/
const LOG_PAGE = 50
const RETRY_ALL_MAX = 200

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'Method not allowed', reason: 'method-not-allowed' },
    { status: 405, headers: { ...noStore, Allow: allow } },
  )
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** A provider's failure, as the page shows it. */
function providerFailure(error: unknown, provider: AccountingProviderId): Response {
  if (error instanceof AccountingProviderError) {
    return refusal(
      error.code === 'auth' ? 409 : 502,
      'provider-error',
      `${ACCOUNTING_PROVIDER_LABELS[provider]}: ${error.message}`,
    )
  }
  throw error
}

export function createAccountingRoutes(deps: AccountingRouteDeps): AccountingRoutes {
  /** Whether a provider can be connected here: its credentials, the state secret, a redirect. */
  const connectable = (provider: AccountingProviderId, requestUrl: string) =>
    deps.readProviderConfig(provider).configured && deps.stateSigningConfigured() && Boolean(deps.redirectUri(requestUrl))

  async function session(
    record: AccountingConnectionRecord,
  ): Promise<{ provider: AccountingProvider; session: AccountingSession } | Response> {
    const provider = deps.providerFor(record.provider)
    const config = deps.readProviderConfig(record.provider)
    if (!provider || !config.configured) return refusal(503, 'not-configured', accountingNotConfiguredMessage(record.provider))
    try {
      return {
        provider,
        session: await connectionSession(
          { firestore: deps.firestore(), keyring: config.config.keyring, provider, now: deps.now },
          record,
        ),
      }
    } catch (error) {
      if (error instanceof AccountingProviderError) return providerFailure(error, record.provider)
      return refusal(409, 'not-connected', `Reconnect ${ACCOUNTING_PROVIDER_LABELS[record.provider]}.`)
    }
  }

  async function connected(gate: AccountingGateContext): Promise<AccountingConnectionRecord | Response> {
    const record = await loadOrgConnection(deps.firestore(), gate.orgId)
    if (!record || record.status !== 'connected') return refusal(409, 'not-connected', 'Connect your books first.')
    return record
  }

  const status: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const gate = await accountingMemberGate(request, new URL(request.url).searchParams.get('orgId'), deps.gate)
    if (gate instanceof Response) return gate
    const providers = Object.fromEntries(
      ACCOUNTING_PROVIDERS.map((provider) => [provider, connectable(provider, request.url)]),
    ) as Record<AccountingProviderId, boolean>
    const record = await loadOrgConnection(deps.firestore(), gate.orgId)
    const counts = record ? await syncCounts(deps.firestore(), gate.orgId) : { pending: 0, synced: 0, needsAttention: 0 }
    return ok({
      providers,
      connection: record ? toConnectionView(record) : null,
      counts,
      seenTaxKeys: record?.seenTaxKeys ?? [],
    } satisfies AccountingStatusResponse)
  }

  const connect: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const provider = body['provider']
    if (!isAccountingProviderId(provider)) return refusal(400, 'invalid-request', 'Choose QuickBooks Online or Xero.')
    const redirectUri = deps.redirectUri(request.url)
    const adapter = deps.providerFor(provider)
    if (!redirectUri || !adapter || !connectable(provider, request.url)) {
      return refusal(503, 'not-configured', accountingNotConfiguredMessage(provider))
    }
    const existing = await loadOrgConnection(deps.firestore(), gate.orgId)
    if (existing && existing.provider !== provider) {
      return refusal(
        409,
        'invalid-request',
        `Disconnect ${ACCOUNTING_PROVIDER_LABELS[existing.provider]} before connecting ${ACCOUNTING_PROVIDER_LABELS[provider]}.`,
      )
    }
    const nowMs = deps.now()
    const { state, claims } = mintAccountingOAuthState({ orgId: gate.orgId, uid: gate.uid, provider, nowMs })
    await recordAccountingOAuthState(deps.firestore(), { claims, redirectUri, nowMs })
    return ok({ url: adapter.authorizeUrl({ state, redirectUri }) })
  }

  const oauthCallback: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const params = new URL(request.url).searchParams
    const read = readAccountingOAuthState(params.get('state'), deps.now())
    const plain = (code: number, text: string) =>
      new Response(text, {
        status: code,
        headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' },
      })
    if (read.ok === false && read.refusal === 'state-invalid') {
      return plain(400, 'This connection link is not valid. Return to the console and connect your books again.')
    }
    const claims = read.ok ? read.claims : (read as { claims: { orgId: string } }).claims
    const org = await deps.gate.readOrg(claims.orgId)
    const slug = typeof org?.['slug'] === 'string' ? org['slug'] : ''
    if (!slug) return plain(404, 'That organization could not be found.')
    const code = params.get('code') ?? ''
    const providerError = params.get('error')
    let fragment: AccountingConnectReturn
    if (providerError) fragment = { kind: 'error', reason: providerError === 'access_denied' ? 'access_denied' : 'provider_error' }
    else if (!read.ok) fragment = { kind: 'error', reason: 'expired' }
    else if (!code || code.length > MAX_CODE_CHARS) fragment = { kind: 'error', reason: 'provider_error' }
    else {
      const realmId = params.get('realmId')
      fragment = {
        kind: 'code',
        code,
        state: params.get('state') ?? '',
        ...(realmId && /^[0-9]{1,32}$/.test(realmId) ? { realmId } : {}),
      }
    }
    // A RELATIVE location on the callback's own origin, built from the
    // organization's slug and never from anything the request supplied.
    return new Response(null, {
      status: 303,
      headers: {
        ...noStore,
        'Referrer-Policy': 'no-referrer',
        Location: `/${encodeURIComponent(slug)}/${ACCOUNTING_CONNECTION_SECTION_PATH}#${buildAccountingConnectFragment(fragment)}`,
      },
    })
  }

  /** Binds a record to one tenant: its name and currency from the ledger. */
  async function bindTenant(record: AccountingConnectionRecord, tenantId: string): Promise<AccountingConnectionRecord | Response> {
    const tenant = record.tenants.find((candidate) => candidate.id === tenantId) ?? (record.tenantId === tenantId ? null : undefined)
    if (tenant === undefined) return refusal(400, 'invalid-request', 'That organization is not one this connection reaches.')
    const bound: AccountingConnectionRecord = {
      ...record,
      status: 'connected',
      tenantId,
      tenantName: tenant?.name || record.tenantName,
      connectionId: tenant?.connectionId ?? record.connectionId,
      tenants: [],
    }
    const opened = await session(bound)
    if (opened instanceof Response) return opened
    try {
      const info = await opened.provider.companyInfo(opened.session)
      bound.tenantName = info.name || bound.tenantName
      bound.homeCurrency = info.homeCurrency
      bound.multiCurrency = info.multiCurrency
    } catch (error) {
      return providerFailure(error, record.provider)
    }
    return bound
  }

  const connectComplete: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const code = typeof body['code'] === 'string' ? body['code'] : ''
    if (!code || code.length > MAX_CODE_CHARS) return refusal(400, 'invalid-request', 'The connection did not return a code.')
    const nowMs = deps.now()
    const read = readAccountingOAuthState(body['state'], nowMs)
    if (read.ok === false && read.refusal === 'state-invalid') {
      return refusal(400, 'state-invalid', 'This connection could not be verified. Connect your books again.')
    }
    const claims = read.ok ? read.claims : (read as { claims: typeof read.claims }).claims
    if (claims.uid !== gate.uid) {
      return refusal(403, 'state-user-mismatch', 'This connection was started by another member. Connect your books again.')
    }
    if (claims.orgId !== gate.orgId) {
      return refusal(400, 'state-org-mismatch', 'This connection was started in another organization.')
    }
    if (!read.ok) return refusal(410, 'state-expired', 'This connection took too long. Connect your books again.')
    const provider = claims.provider
    const adapter = deps.providerFor(provider)
    const config = deps.readProviderConfig(provider)
    if (!adapter || !config.configured) return refusal(503, 'not-configured', accountingNotConfiguredMessage(provider))

    const firestore = deps.firestore()
    const consumed = await consumeAccountingOAuthState(firestore, { claims, nowMs })
    if (consumed.ok === false) {
      if (consumed.refusal === 'state-expired') {
        return refusal(410, 'state-expired', 'This connection took too long. Connect your books again.')
      }
      return refusal(
        409,
        consumed.refusal,
        consumed.refusal === 'state-superseded'
          ? 'A newer connection was started. Finish that one, or connect again.'
          : 'This connection was already used. Connect your books again.',
      )
    }
    const previous = await loadOrgConnection(firestore, gate.orgId)
    if (previous && previous.provider !== provider) {
      return refusal(409, 'invalid-request', `Disconnect ${ACCOUNTING_PROVIDER_LABELS[previous.provider]} first.`)
    }
    let exchanged: Awaited<ReturnType<AccountingProvider['exchangeCode']>>
    try {
      exchanged = await adapter.exchangeCode({
        code,
        redirectUri: consumed.redirectUri,
        realmId: typeof body['realmId'] === 'string' ? body['realmId'] : null,
      })
    } catch (error) {
      return providerFailure(error, provider)
    }
    if (!exchanged.tenants.length) {
      return refusal(400, 'provider-error', `${ACCOUNTING_PROVIDER_LABELS[provider]} did not grant access to any organization.`)
    }
    let record = newConnectionRecord({
      keyring: config.config.keyring,
      orgId: gate.orgId,
      provider,
      tokens: exchanged.tokens,
      tenants: exchanged.tenants,
      environment: provider === 'quickbooks' ? config.config.environment : null,
      uid: gate.uid,
      email: gate.email,
      nowMs,
      previous: previous?.provider === provider ? previous : null,
    })
    // The grant is stored before anything else is asked of it, so a failure
    // below leaves a connection to retry rather than a spent code.
    await connectionRef(firestore, gate.orgId, provider).set(record)
    if (record.status === 'connected' && record.tenantId) {
      const bound = await bindTenant({ ...record, tenants: exchanged.tenants }, record.tenantId)
      if (bound instanceof Response) return bound
      record = bound
      await connectionRef(firestore, gate.orgId, provider).set(record)
    }
    await deps.logOrgActivity(gate.orgId, { uid: gate.uid, email: gate.email }, 'accounting.connected', {
      type: ACCOUNTING_ACTIVITY_TARGET,
      id: provider,
      name: `${ACCOUNTING_PROVIDER_LABELS[provider]}${record.tenantName ? ` — ${record.tenantName}` : ''}`,
    })
    return ok({ connection: toConnectionView(record) })
  }

  const selectTenant: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const record = await loadOrgConnection(deps.firestore(), gate.orgId)
    if (!record || record.status !== 'choose-tenant') return refusal(409, 'not-connected', 'There is no organization to choose.')
    const tenantId = typeof body['tenantId'] === 'string' ? body['tenantId'] : ''
    const bound = await bindTenant(record, tenantId)
    if (bound instanceof Response) return bound
    await connectionRef(deps.firestore(), gate.orgId, record.provider).set(bound)
    await deps.logOrgActivity(gate.orgId, { uid: gate.uid, email: gate.email }, 'accounting.connected', {
      type: ACCOUNTING_ACTIVITY_TARGET,
      id: record.provider,
      name: `${ACCOUNTING_PROVIDER_LABELS[record.provider]}${bound.tenantName ? ` — ${bound.tenantName}` : ''}`,
    })
    return ok({ connection: toConnectionView(bound) })
  }

  const options: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const gate = await accountingMemberGate(request, new URL(request.url).searchParams.get('orgId'), deps.gate)
    if (gate instanceof Response) return gate
    const record = await connected(gate)
    if (record instanceof Response) return record
    const opened = await session(record)
    if (opened instanceof Response) return opened
    try {
      const [accounts, taxCodes] = await Promise.all([
        opened.provider.listAccounts(opened.session),
        opened.provider.listTaxRates(opened.session),
      ])
      accounts.sort((a, b) => a.name.localeCompare(b.name))
      return ok({ accounts, taxCodes } satisfies AccountingOptionsResponse)
    } catch (error) {
      return providerFailure(error, record.provider)
    }
  }

  const settings: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const record = await connected(gate)
    if (record instanceof Response) return record
    const opened = await session(record)
    if (opened instanceof Response) return opened
    const firestore = deps.firestore()
    try {
      const [accounts, taxCodes] = await Promise.all([
        opened.provider.listAccounts(opened.session),
        opened.provider.listTaxRates(opened.session),
      ])
      const checked = validateAccountingMapping(body['mapping'], {
        accounts,
        taxCodes,
        today: dateInZone(deps.now(), 'UTC'),
      })
      if (checked.ok === false) {
        return Response.json(
          { error: checked.issues[0]?.message ?? 'Check the settings.', reason: 'invalid-request', issues: checked.issues },
          { status: 400, headers: noStore },
        )
      }
      const mapping = checked.mapping
      const extras = await opened.provider.prepare(opened.session, mapping.accounts, record.extras)
      const nowMs = deps.now()
      const startMs = mapping.startDate ? Date.parse(`${mapping.startDate}T00:00:00Z`) : null
      await connectionRef(firestore, gate.orgId, record.provider).update({
        mapping,
        extras: { ...record.extras, ...extras },
        // Payouts from the start date on belong in the books too.
        ...(startMs !== null && startMs < record.payoutCursorMs ? { payoutCursorMs: startMs, payoutPolledAtMs: 0 } : {}),
        updatedAtMs: nowMs,
      })
      const backfill = (record as AccountingConnectionRecord & { backfill?: { fromMs: number } }).backfill
      if (startMs !== null && startMs < record.connectedAtMs && (!backfill || startMs < backfill.fromMs)) {
        await startBackfill(firestore, { ...record, mapping }, startMs)
      }
      await deps.logOrgActivity(gate.orgId, { uid: gate.uid, email: gate.email }, 'accounting.settingsChanged', {
        type: ACCOUNTING_ACTIVITY_TARGET,
        id: record.provider,
        name: ACCOUNTING_PROVIDER_LABELS[record.provider],
      })
      return ok({ connection: toConnectionView({ ...record, mapping, extras: { ...record.extras, ...extras } }) })
    } catch (error) {
      return providerFailure(error, record.provider)
    }
  }

  const log: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const params = new URL(request.url).searchParams
    const gate = await accountingMemberGate(request, params.get('orgId'), deps.gate)
    if (gate instanceof Response) return gate
    const filter = params.get('filter') === 'attention' ? 'needs_attention' : null
    const before = Number(params.get('before'))
    let query: FirebaseFirestore.Query = syncItemsCollection(deps.firestore(), gate.orgId)
    if (filter) query = query.where('status', '==', filter)
    query = query.orderBy('updatedAtMs', 'desc')
    if (Number.isFinite(before) && before > 0) query = query.where('updatedAtMs', '<', before)
    const snapshot = await query.limit(LOG_PAGE).get()
    const items = snapshot.docs
      .map((doc) => readSyncItem(doc.id, doc.data()))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map(toSyncItemView)
    return ok({
      items,
      nextBefore: snapshot.size === LOG_PAGE ? (items[items.length - 1]?.updatedAtMs ?? null) : null,
    } satisfies AccountingLogResponse)
  }

  const retry: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const firestore = deps.firestore()
    const items = syncItemsCollection(firestore, gate.orgId)
    const nowMs = deps.now()
    let refs: FirebaseFirestore.DocumentReference[]
    if (body['all'] === true) {
      refs = (await items.where('status', '==', 'needs_attention').limit(RETRY_ALL_MAX).get()).docs.map((doc) => doc.ref)
    } else {
      const itemId = typeof body['itemId'] === 'string' ? body['itemId'] : ''
      if (!ITEM_ID.test(itemId)) return refusal(400, 'invalid-request', 'Name the item to retry.')
      refs = [items.doc(itemId)]
    }
    let retried = 0
    for (const ref of refs) {
      const changed = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        const item = readSyncItem(ref.id, snapshot.exists ? snapshot.data() : undefined)
        if (!item || item.status !== 'needs_attention') return false
        transaction.update(ref, {
          status: 'pending',
          attempts: 0,
          // A fresh idempotency key: the ledger may remember the refused one.
          generation: item.generation + 1,
          // A summary member goes back to waiting for its journal.
          nextAttemptAtMs: item.mode === 'summary' && item.kind !== 'summary' ? Number.MAX_SAFE_INTEGER : nowMs,
          summaryItemId: null,
          errorCode: null,
          updatedAtMs: nowMs,
        })
        return true
      })
      if (changed) retried += 1
    }
    if (!retried && body['all'] !== true) return refusal(404, 'not-found', 'That item does not need attention.')
    await deps.logOrgActivity(gate.orgId, { uid: gate.uid, email: gate.email }, 'accounting.syncRetried', {
      type: ACCOUNTING_ACTIVITY_TARGET,
      id: body['all'] === true ? 'all' : String(body['itemId']),
      name: `${retried} ${retried === 1 ? 'item' : 'items'}`,
    })
    return ok({ retried })
  }

  const disconnect: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await accountingMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const record = await loadOrgConnection(deps.firestore(), gate.orgId)
    if (!record) return ok({ disconnected: false })
    const adapter = deps.providerFor(record.provider)
    const config = deps.readProviderConfig(record.provider)
    let revoked = false
    if (adapter && config.configured) {
      try {
        // Revoked at the provider first: a grant only deleted here would
        // still open the books.
        await adapter.revoke({
          refreshToken: openToken(config.config.keyring, record, 'refresh').token,
          accessToken: record.sealedAccessToken ? openToken(config.config.keyring, record, 'access').token : null,
          connectionId: record.connectionId,
        })
        revoked = true
      } catch (error) {
        console.error('[accounting] revoke failed; removing the connection anyway', error)
      }
    }
    // The sync log stays: it is the record of what was posted, and it is what
    // keeps a reconnect of the same books from posting anything twice.
    await connectionRef(deps.firestore(), gate.orgId, record.provider).delete()
    await deps.logOrgActivity(gate.orgId, { uid: gate.uid, email: gate.email }, 'accounting.disconnected', {
      type: ACCOUNTING_ACTIVITY_TARGET,
      id: record.provider,
      name: `${ACCOUNTING_PROVIDER_LABELS[record.provider]}${record.tenantName ? ` — ${record.tenantName}` : ''}`,
    })
    return ok({ disconnected: true, revoked })
  }

  return { status, connect, oauthCallback, connectComplete, selectTenant, options, settings, log, retry, disconnect }
}

/** The route table, for the registration and its spec. */
export const ACCOUNTING_ROUTE_PATHS = ACCOUNTING_API_ROUTES
