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

import { LOG_PAGE_LIMIT, SYNC_NOW_MAX_PAGES } from '../constants'
import {
  HELP_DESK_PROVIDERS,
  helpDeskConnectionId,
  isHelpDeskProviderId,
  readConnectionSettings,
  readCredentialInput,
  type HelpDeskProviderId,
} from '../model/connections'
import { isProviderError } from '../providers/http'
import type { HelpDeskProvider, HelpDeskVerified } from '../providers/provider'
import { availableProviders, sealCredential, type HelpDesksConfig } from './config'
import { connectionView, emptyConnection, type ConnectionStore, type StoredConnection } from './store'

/**
 * The console routes of the help desks card (AGL-3824). Every route is
 * behind {@link HelpDeskRouteDeps.gate}: a signed-in, verified member of the
 * site, at `editor` to read and `admin` to change anything, on a plan with
 * the store, the site not locked.
 *
 * No answer ever carries a credential: the card sees {@link connectionView}.
 */

export type HelpDeskRole = 'editor' | 'admin'

export interface HelpDeskGateResult {
  orgId: string
  hostId: string
  uid: string
  body: Record<string, unknown>
}

export interface HelpDeskRouteDeps {
  now(): number
  config(): HelpDesksConfig
  store: ConnectionStore
  provider(id: HelpDeskProviderId): HelpDeskProvider
  gate(request: Request, role: HelpDeskRole): Promise<HelpDeskGateResult | Response>
  /** Runs a connection's sync now, a few pages at most; the job continues it. */
  syncNow(connectionId: string, maxPages: number): Promise<unknown>
  /** Records a connect or a disconnect on the workspace's activity log. Must not throw. */
  logActivity(input: {
    orgId: string
    uid: string
    action: 'connected' | 'disconnected'
    provider: HelpDeskProviderId
    hostId: string
  }): Promise<void>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
export const fail = (status: number, error: string): Response => json({ error }, status)

function readProvider(body: Record<string, unknown>, request: Request): HelpDeskProviderId | null {
  const raw = body['provider'] ?? new URL(request.url).searchParams.get('provider')
  return isHelpDeskProviderId(raw) ? raw : null
}

function refusedConnect(error: unknown, label: string): Response {
  if (isProviderError(error)) {
    if (error.kind === 'auth') return fail(400, `${label} did not accept those details. Check them and try again.`)
    if (error.kind === 'rate-limit') return fail(429, `${label} asked us to slow down. Try again in a minute.`)
    if (error.kind === 'invalid') {
      return error.status === 404
        ? fail(400, `${label} has no account at that address. Check it and try again.`)
        : fail(400, error.message)
    }
    return fail(502, `${label} could not be reached. Try again in a minute.`)
  }
  console.error('[help-desks] connect failed', error)
  return fail(500, 'The connection could not be made')
}

export function createHelpDeskRoutes(deps: HelpDeskRouteDeps) {
  return {
    /** GET ?hostId — what this deployment offers, and the site's connections. */
    async list(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const available = availableProviders(deps.config())
      const connections = (await deps.store.listForHost(gate.hostId)).map(({ id, connection }) =>
        connectionView(id, connection),
      )
      return json({ available, connections })
    },

    /** POST { hostId, provider, …credential } — connect with the merchant's own credential. */
    async connect(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a help desk')
      const config = deps.config()
      if (!config.keyring || !availableProviders(config).includes(provider)) {
        return fail(404, `${HELP_DESK_PROVIDERS[provider].label} cannot be connected here`)
      }
      const read = readCredentialInput(provider, gate.body)
      if (read.ok === false) return fail(400, read.error)
      const values = read.values
      const label = HELP_DESK_PROVIDERS[provider].label
      const credential = {
        account: values.account,
        login: values.login,
        token: values.token ?? '',
        appClientId: values.appClientId,
        supportEmail: values.supportEmail,
      }
      let verified: HelpDeskVerified
      try {
        verified = await deps.provider(provider).verify(credential)
      } catch (error) {
        return refusedConnect(error, label)
      }

      const id = helpDeskConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      const nowMs = deps.now()
      const sameAccount = Boolean(
        existing && existing.account === values.account && (existing.accountName ?? null) === (verified.accountName ?? null),
      )
      // A different account starts empty: every id remembered for a buyer
      // belongs to the old one, and everyone is copied again.
      if (existing && !sameAccount) await deps.store.clearCustomers(id)
      const base = emptyConnection({ orgId: gate.orgId, hostId: gate.hostId, provider, nowMs })
      const keptTarget =
        existing?.targetId && verified.targets.some((target) => target.id === existing.targetId) ? existing.targetId : null
      const stored: StoredConnection = {
        ...base,
        accountName: verified.accountName ?? values.account,
        account: values.account,
        supportEmail: values.supportEmail,
        targets: verified.targets.slice(0, 200),
        targetId: keptTarget ?? (verified.targets.length === 1 ? verified.targets[0].id : null),
        // A merchant's own choices survive connecting again.
        syncCustomers: existing ? existing.syncCustomers !== false : true,
        sendTickets: existing ? existing.sendTickets === true : false,
        ...(existing && sameAccount
          ? { cursors: existing.cursors ?? base.cursors, backfill: existing.backfill ?? base.backfill, totals: existing.totals ?? base.totals }
          : {}),
        sealedToken: sealCredential(
          { token: credential.token, login: credential.login, appClientId: credential.appClientId },
          id,
          config.keyring,
        ),
        tokenKeyId: config.keyring.current.id,
        connectedAtMs: existing && sameAccount ? (existing.connectedAtMs ?? nowMs) : nowMs,
        connectedByUid: gate.uid,
      }
      await deps.store.patch(id, stored)
      await deps.store.appendLog(id, { atMs: nowMs, kind: 'run', message: 'Connected' })
      await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'connected', provider, hostId: gate.hostId })
      return json({ connection: connectionView(id, stored) })
    },

    /** PATCH { hostId, provider, …settings } · DELETE { hostId, provider } */
    async connection(request: Request): Promise<Response> {
      if (request.method !== 'PATCH' && request.method !== 'DELETE') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a help desk')
      const id = helpDeskConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That help desk is not connected')

      if (request.method === 'DELETE') {
        await deps.store.remove(id)
        await deps.logActivity({ orgId: gate.orgId, uid: gate.uid, action: 'disconnected', provider, hostId: gate.hostId })
        return json({ ok: true })
      }

      const read = readConnectionSettings(gate.body)
      if (read.ok === false) return fail(400, read.error)
      const settings = read.settings
      const patch: Partial<StoredConnection> = { updatedAtMs: deps.now() }
      if (settings.targetId !== undefined && settings.targetId !== existing.targetId) {
        if (settings.targetId && !(existing.targets ?? []).some((target) => target.id === settings.targetId)) {
          return fail(400, 'Choose one from the menu')
        }
        patch.targetId = settings.targetId
        patch.nextRunAtMs = deps.now()
      }
      if (settings.syncCustomers !== undefined) patch.syncCustomers = settings.syncCustomers
      if (settings.sendTickets !== undefined) patch.sendTickets = settings.sendTickets
      if (settings.paused !== undefined) {
        if (existing.status === 'reconnect') return fail(409, 'Connect again first')
        patch.status = settings.paused ? 'paused' : 'active'
        if (!settings.paused) {
          patch.nextRunAtMs = deps.now()
          patch.consecutiveFailures = 0
        }
      }
      await deps.store.patch(id, patch)
      return json({ connection: connectionView(id, { ...existing, ...patch }) })
    },

    /** POST { hostId, provider } — run the sync now; resumes one stopped by failures. */
    async syncNow(request: Request): Promise<Response> {
      if (request.method !== 'POST') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'admin')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a help desk')
      const id = helpDeskConnectionId(gate.hostId, provider)
      const existing = await deps.store.get(id)
      if (!existing || existing.hostId !== gate.hostId) return fail(404, 'That help desk is not connected')
      if (existing.status === 'reconnect') return fail(409, 'Connect again first')
      if (existing.status === 'paused') return fail(409, 'Resume the connection first')
      await deps.store.patch(id, { status: 'active', consecutiveFailures: 0, nextRunAtMs: deps.now(), leaseUntilMs: 0 })
      await deps.syncNow(id, SYNC_NOW_MAX_PAGES)
      const after = await deps.store.get(id)
      return json({ connection: after ? connectionView(id, after) : null })
    },

    /** GET ?hostId&provider&before — the connection's runs and errors, newest first. */
    async log(request: Request): Promise<Response> {
      if (request.method !== 'GET') return fail(405, 'Method not allowed')
      const gate = await deps.gate(request, 'editor')
      if (gate instanceof Response) return gate
      const provider = readProvider(gate.body, request)
      if (!provider) return fail(400, 'Choose a help desk')
      const id = helpDeskConnectionId(gate.hostId, provider)
      const before = Number(new URL(request.url).searchParams.get('before'))
      const entries = await deps.store.readLog(id, LOG_PAGE_LIMIT + 1, Number.isFinite(before) && before > 0 ? before : null)
      const page = entries.slice(0, LOG_PAGE_LIMIT)
      return json({
        entries: page,
        nextBefore: entries.length > LOG_PAGE_LIMIT ? (page[page.length - 1]?.atMs ?? null) : null,
      })
    },
  }
}

export type HelpDeskRoutes = ReturnType<typeof createHelpDeskRoutes>
