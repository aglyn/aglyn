/**
 * @jest-environment node
 */
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

import { createSecretBoxKey } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import { parseAccountingConnectFragment, type AccountingProviderId } from '../model/accounting.types'
import { asFirestore, memoryFirestore } from '../testing/memory-firestore'
import type { AccountingProviderConfigResult } from './accounting-config'
import { createAccountingRoutes, type AccountingRouteDeps } from './accounting-routes'
import { newConnectionRecord, openToken, readConnection, toStoredConnection } from './connection-store'
import { AccountingProviderError } from './providers/http'
import type { AccountingProvider } from './providers/provider'
import { enqueueOrderPaid, runSyncPass } from './sync-engine'
import { saleItemId } from './sync-store'

const NOW = Date.UTC(2026, 9, 6, 18)
const key = createSecretBoxKey(randomBytes(32))
const keyring = { current: key, keys: [key] }

const configured: AccountingProviderConfigResult = {
  configured: true,
  config: { clientId: 'id', clientSecret: 'secret', keyring, environment: 'sandbox', scopes: null, apiKey: null },
}

function fakeProvider(id: AccountingProviderId, overrides: Partial<AccountingProvider> = {}): AccountingProvider {
  return {
    id,
    picksTenantAfterExchange: id !== 'quickbooks',
    authorizeUrl: ({ state }) => `https://consent.example/?state=${encodeURIComponent(state)}`,
    exchangeCode: jest.fn(async () => ({
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAtMs: NOW + 3_600_000, refreshExpiresAtMs: null, scopes: [] },
      tenants: [{ id: 'realm-1', name: '' }],
    })),
    refresh: jest.fn(),
    revoke: jest.fn(async () => undefined),
    companyInfo: jest.fn(async () => ({ name: 'Sandbox Company', homeCurrency: 'USD', multiCurrency: false })),
    listAccounts: jest.fn(async () => [
      { id: '79', code: null, name: 'Sales', type: 'Income', classification: 'income' as const, currency: 'USD' },
      { id: '35', code: null, name: 'Stripe clearing', type: 'Bank', classification: 'bank' as const, currency: 'USD' },
      { id: '36', code: null, name: 'Checking', type: 'Bank', classification: 'bank' as const, currency: 'USD' },
      { id: '60', code: null, name: 'Merchant fees', type: 'Expense', classification: 'expense' as const, currency: 'USD' },
    ]),
    listTaxRates: jest.fn(async () => [{ id: 'TAX', name: 'Taxable', ratePercent: null }]),
    prepare: jest.fn(async () => ({ saleItemId: '20', shippingItemId: '21' })),
    upsertCustomer: jest.fn(),
    createSalesReceipt: jest.fn(),
    createRefundReceipt: jest.fn(),
    createExpense: jest.fn(),
    createDeposit: jest.fn(),
    createJournal: jest.fn(),
    findByExternalId: jest.fn(),
    ...overrides,
  }
}

function setup(
  options: { permissions?: Record<string, boolean>; commerce?: boolean; xeroConfigured?: boolean; codatConfigured?: boolean } = {},
) {
  const store = memoryFirestore()
  const providers = {
    quickbooks: fakeProvider('quickbooks'),
    xero: fakeProvider('xero'),
    codat: fakeProvider('codat', {
      authorizeUrl: jest.fn(async ({ state }: { state: string }) => `https://link.codat.io/company/c-1?state=${encodeURIComponent(state)}`),
      exchangeCode: jest.fn(async () => ({
        tokens: { accessToken: 'c-1', refreshToken: 'c-1', accessExpiresAtMs: Number.MAX_SAFE_INTEGER, refreshExpiresAtMs: null, scopes: [] },
        tenants: [{ id: 'conn-1', name: 'NetSuite', connectionId: 'conn-1' }],
      })),
      companyInfo: jest.fn(async () => ({ name: 'Acme Inc (NetSuite)', homeCurrency: 'USD', multiCurrency: true })),
    }),
  }
  // Codat is env-gated: unconfigured unless a spec says otherwise.
  const unconfigured = (provider: AccountingProviderId) =>
    (provider === 'xero' && options.xeroConfigured === false) || (provider === 'codat' && !options.codatConfigured)
  const activity: string[] = []
  const deps: AccountingRouteDeps = {
    firestore: () => asFirestore(store),
    gate: {
      verifyIdToken: async (token) => {
        if (token !== 'good') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
        return { uid: 'u-1', email: 'Owner@Example.com', email_verified: true } as never
      },
      resolveOrgPermissions: async () => ({
        orgId: 'org-1',
        role: 'owner',
        orgWide: true,
        permissions: options.permissions ?? { 'accounting.manage': true },
      }),
      readOrg: async (orgId) =>
        orgId === 'org-1'
          ? { slug: 'acme', name: 'Acme', entitlements: { features: { commerce: options.commerce ?? true } } }
          : null,
      lockdownRefusal: async () => null,
    },
    readProviderConfig: (provider) => (unconfigured(provider) ? { configured: false, missing: ['ENV'] } : configured),
    keyring: () => keyring,
    providerFor: (provider) => (unconfigured(provider) ? null : providers[provider]),
    stateSigningConfigured: () => true,
    redirectUri: () => 'https://app.aglyn.com/api/accounting/oauth/callback',
    now: () => NOW,
    logOrgActivity: async (_orgId, _actor, action) => void activity.push(action),
  }
  const created = createAccountingRoutes(deps)
  // Each handler as the dispatcher calls it, with no path params.
  const routes = Object.fromEntries(
    Object.entries(created).map(([name, handler]) => [name, (request: Request) => handler(request, { params: {} })]),
  ) as Record<keyof typeof created, (request: Request) => Promise<Response>>
  const request = (method: 'GET' | 'POST', url: string, body?: unknown, token = 'good') =>
    new Request(`https://app.aglyn.com/api/${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  return { store, routes, request, providers, activity, deps }
}

/** Seeds a Xero connection to Demo Company (US), its accounts chosen. */
function seedXero(context: ReturnType<typeof setup>) {
  const record = newConnectionRecord({
    keyring,
    orgId: 'org-1',
    provider: 'xero',
    tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAtMs: NOW + 3_600_000, refreshExpiresAtMs: null, scopes: [] },
    tenants: [{ id: 'tenant-1', name: 'Demo Company (US)', connectionId: 'conn-1' }],
    environment: null,
    uid: 'u-1',
    email: 'owner@example.com',
    nowMs: NOW - 86_400_000,
    previous: null,
  })
  record.mapping = {
    ...record.mapping,
    accounts: { income: 'inc', clearing: 'clr', feeExpense: 'fee', payoutBank: 'bank' },
  }
  context.store.seed('orgs/org-1/accountingConnections/xero', toStoredConnection(record, keyring) as never)
}

/** What Xero answers once the organization removed the app. */
const removedInXero = () => new AccountingProviderError('revoked', 'AuthenticationUnsuccessful', 403)
const PLAIN = 'Xero no longer lets Aglyn reach Demo Company (US). Reconnect to keep posting.'

/** Connects QuickBooks end to end and answers the stored record. */
async function connectQuickBooks(context: ReturnType<typeof setup>) {
  const started = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'quickbooks' }))
  const { url } = (await started.json()) as { url: string }
  const state = new URL(url).searchParams.get('state') ?? ''
  const callback = await context.routes.oauthCallback(
    new Request(`https://app.aglyn.com/api/accounting/oauth/callback?code=code-1&state=${encodeURIComponent(state)}&realmId=9130`),
  )
  const location = callback.headers.get('location') ?? ''
  const returned = parseAccountingConnectFragment(location.split('#')[1] ?? '')
  if (returned?.kind !== 'code') throw new Error('no code')
  return context.routes.connectComplete(
    context.request('POST', 'accounting/connect/complete', { orgId: 'org-1', ...returned }),
  )
}

describe('accounting routes', () => {
  const saved = process.env['TOKEN_SIGNING_SECRET']
  beforeAll(() => {
    process.env['TOKEN_SIGNING_SECRET'] = 'routes-secret'
  })
  afterAll(() => {
    if (saved === undefined) delete process.env['TOKEN_SIGNING_SECRET']
    else process.env['TOKEN_SIGNING_SECRET'] = saved
  })

  it('refuses without a session, without the permission, and without commerce', async () => {
    const noSession = setup()
    expect((await noSession.routes.status(noSession.request('GET', 'accounting/status?orgId=org-1', undefined, 'bad'))).status).toBe(401)
    const noPermission = setup({ permissions: {} })
    expect((await noPermission.routes.status(noPermission.request('GET', 'accounting/status?orgId=org-1'))).status).toBe(403)
    const noCommerce = setup({ commerce: false })
    const refused = await noCommerce.routes.status(noCommerce.request('GET', 'accounting/status?orgId=org-1'))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ reason: 'entitlement' })
  })

  it('offers only the providers this deployment is configured for', async () => {
    const context = setup({ xeroConfigured: false })
    const response = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
    expect(await response.json()).toMatchObject({ providers: { quickbooks: true, xero: false }, connection: null })
    const refused = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'xero' }))
    expect(refused.status).toBe(503)
  })

  it('connects QuickBooks through the signed state, seals the grant and names the company', async () => {
    const context = setup()
    const completed = await connectQuickBooks(context)
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      connection: { provider: 'quickbooks', status: 'connected', tenantName: 'Sandbox Company', homeCurrency: 'USD' },
    })
    expect(context.providers.quickbooks.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1', realmId: '9130', redirectUri: 'https://app.aglyn.com/api/accounting/oauth/callback' }),
    )
    const stored = context.store.read('orgs/org-1/accountingConnections/quickbooks')!
    const record = readConnection(stored, keyring)!
    expect(openToken(keyring, record, 'refresh').token).toBe('refresh-1')
    expect(JSON.stringify(record)).not.toContain('refresh-1')
    expect(context.activity).toContain('accounting.connected')
  })

  it('stores the QuickBooks company id (realmID) sealed, and never sends it to the page', async () => {
    const context = setup()
    const completed = await connectQuickBooks(context)
    expect(((await completed.json()) as { connection: Record<string, unknown> }).connection).not.toHaveProperty('tenantId')
    const stored = context.store.read('orgs/org-1/accountingConnections/quickbooks')!
    expect(stored['tenantId']).toBeNull()
    expect(typeof stored['sealedTenantId']).toBe('string')
    expect(JSON.stringify(stored)).not.toContain('realm-1')
    // Opened with the key, bound to this document: a copy in another
    // workspace, or a read with no key, reaches no company.
    expect(readConnection(stored, keyring)!.tenantId).toBe('realm-1')
    expect(readConnection({ ...stored, orgId: 'org-2' }, keyring)!.tenantId).toBeNull()
    expect(readConnection(stored, null)!.tenantId).toBeNull()
    const status = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
    expect(JSON.stringify(await status.json())).not.toContain('realm-1')
  })

  it('still reads a connection stored before the company id was sealed, and seals it when the whole document is next written', async () => {
    const context = setup()
    await connectQuickBooks(context)
    const sealed = context.store.read('orgs/org-1/accountingConnections/quickbooks')!
    const legacy = { ...sealed, tenantId: 'realm-1' } as Record<string, unknown>
    delete legacy['sealedTenantId']
    expect(readConnection(legacy, keyring)!.tenantId).toBe('realm-1')
    const resealed = toStoredConnection(readConnection(legacy, keyring)!, keyring)
    expect(resealed.tenantId).toBeNull()
    expect(JSON.stringify(resealed)).not.toContain('realm-1')
  })

  it('sends the member back to the Connection section, and never acts on a forged state', async () => {
    const context = setup()
    const forged = await context.routes.oauthCallback(
      new Request('https://app.aglyn.com/api/accounting/oauth/callback?code=x&state=as1.forged.sig'),
    )
    expect(forged.status).toBe(400)
    const started = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'quickbooks' }))
    const state = new URL(((await started.json()) as { url: string }).url).searchParams.get('state') ?? ''
    const denied = await context.routes.oauthCallback(
      new Request(`https://app.aglyn.com/api/accounting/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`),
    )
    expect(denied.headers.get('location')).toBe('/acme/accounting/connection#accounting=error&reason=access_denied')
  })

  it('refuses a replayed code exchange', async () => {
    const context = setup()
    const started = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'quickbooks' }))
    const state = new URL(((await started.json()) as { url: string }).url).searchParams.get('state') ?? ''
    const body = { orgId: 'org-1', code: 'code-1', state, realmId: '9130' }
    expect((await context.routes.connectComplete(context.request('POST', 'accounting/connect/complete', body))).status).toBe(200)
    const replay = await context.routes.connectComplete(context.request('POST', 'accounting/connect/complete', body))
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchObject({ reason: 'state-replayed' })
  })

  it('checks a mapping against the chart: a bank account for clearing, distinct from the payout bank', async () => {
    const context = setup()
    await connectQuickBooks(context)
    const bad = await context.routes.settings(
      context.request('POST', 'accounting/settings', {
        orgId: 'org-1',
        mapping: { accounts: { income: '79', clearing: '79', payoutBank: '36', feeExpense: '60' } },
      }),
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ issues: [{ field: 'accounts.clearing' }] })
    const good = await context.routes.settings(
      context.request('POST', 'accounting/settings', {
        orgId: 'org-1',
        mapping: {
          accounts: { income: '79', clearing: '35', payoutBank: '36', feeExpense: '60' },
          taxCodes: { taxed: 'TAX' },
          syncMode: 'per-order',
          startDate: '2026-09-01',
          timeZone: 'America/Chicago',
        },
      }),
    )
    expect(good.status).toBe(200)
    expect(await good.json()).toMatchObject({ connection: { missingRoles: [] } })
    const record = context.store.read('orgs/org-1/accountingConnections/quickbooks')!
    expect(record['extras']).toEqual({ saleItemId: '20', shippingItemId: '21' })
    // A start date before the connection starts a backfill and rewinds the payout cursor.
    expect(record['backfill']).toMatchObject({ fromMs: Date.parse('2026-09-01T00:00:00Z'), done: false })
    expect(record['payoutCursorMs']).toBe(Date.parse('2026-09-01T00:00:00Z'))
  })

  it('retries an item that needs attention with a fresh idempotency generation', async () => {
    const context = setup()
    context.store.seed('orgs/org-1/accountingSyncItems/sale_h_o', {
      kind: 'sale',
      mode: 'per-order',
      status: 'needs_attention',
      attempts: 3,
      generation: 0,
      updatedAtMs: NOW - 1000,
    })
    const response = await context.routes.retry(context.request('POST', 'accounting/retry', { orgId: 'org-1', itemId: 'sale_h_o' }))
    expect(await response.json()).toEqual({ retried: 1 })
    expect(context.store.read('orgs/org-1/accountingSyncItems/sale_h_o')).toMatchObject({
      status: 'pending',
      attempts: 0,
      generation: 1,
      nextAttemptAtMs: NOW,
    })
  })

  it('revokes the grant at the provider on disconnect, and keeps the sync log', async () => {
    const context = setup()
    await connectQuickBooks(context)
    context.store.seed('orgs/org-1/accountingSyncItems/sale_h_o', { kind: 'sale', status: 'synced', updatedAtMs: NOW })
    const response = await context.routes.disconnect(context.request('POST', 'accounting/disconnect', { orgId: 'org-1' }))
    expect(await response.json()).toEqual({ disconnected: true, revoked: true })
    expect(context.providers.quickbooks.revoke).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'refresh-1' }))
    expect(context.store.read('orgs/org-1/accountingConnections/quickbooks')).toBeUndefined()
    expect(context.store.read('orgs/org-1/accountingSyncItems/sale_h_o')).toBeDefined()
    expect(context.activity).toContain('accounting.disconnected')
  })

  it('will not connect a second provider over the first', async () => {
    const context = setup()
    await connectQuickBooks(context)
    const refused = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'xero' }))
    expect(refused.status).toBe(409)
  })

  describe('when the app is removed inside Xero', () => {
    it('flips the connection to reconnect-required from the options route, and the status route then says so', async () => {
      const context = setup()
      seedXero(context)
      ;(context.providers.xero.listAccounts as jest.Mock).mockRejectedValue(removedInXero())
      const options = await context.routes.options(context.request('GET', 'accounting/options?orgId=org-1'))
      expect(options.status).toBe(409)
      expect(await options.json()).toEqual({ reason: 'reconnect-required', error: PLAIN })
      const status = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
      expect(await status.json()).toMatchObject({
        providers: { xero: true },
        connection: { provider: 'xero', status: 'reconnect-required', tenantName: 'Demo Company (US)', lastError: PLAIN },
      })
    })

    it('reports the reconnect state on the status route after a sync pass meets it, with the sale still queued', async () => {
      const context = setup()
      seedXero(context)
      const xero = context.providers.xero
      ;(xero.findByExternalId as jest.Mock).mockRejectedValue(removedInXero())
      const engine = {
        firestore: context.deps.firestore,
        keyring: () => keyring,
        providerFor: () => xero,
        now: () => NOW,
        sleep: async () => undefined,
      }
      const order = {
        orgId: 'org-1',
        hostId: 'host-1',
        orderId: 'order-1',
        number: 1,
        currency: 'usd',
        paidAtMs: NOW - 60_000,
        channel: 'online',
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
        lines: [{ name: 'Mug', quantity: 1, unitAmountCents: 1000 }],
        totals: { itemsCents: 1000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 1000, feeCents: 0 },
        taxInclusive: false,
        taxKey: null,
      }
      await enqueueOrderPaid(engine, order)
      const record = readConnection(context.store.read('orgs/org-1/accountingConnections/xero'), keyring)!
      await expect(runSyncPass(engine, record, { deadlineMs: NOW + 60_000 })).resolves.toMatchObject({ stopped: 'reconnect' })
      const status = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
      expect(await status.json()).toMatchObject({
        connection: { status: 'reconnect-required', lastError: PLAIN },
        counts: { pending: 1, needsAttention: 0 },
      })
      expect(context.store.read(`orgs/org-1/accountingSyncItems/${saleItemId(order)}`)).toMatchObject({ status: 'pending' })
    })

    it('keeps any other 403 a provider error, and the connection connected', async () => {
      const context = setup()
      seedXero(context)
      ;(context.providers.xero.listAccounts as jest.Mock).mockRejectedValue(
        new AccountingProviderError('validation', 'This organisation has reached the limit of its plan.', 403),
      )
      const options = await context.routes.options(context.request('GET', 'accounting/options?orgId=org-1'))
      expect(options.status).toBe(422)
      expect(await options.json()).toMatchObject({
        reason: 'provider-error',
        error: 'Xero: This organisation has reached the limit of its plan.',
      })
      const status = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
      expect(await status.json()).toMatchObject({ connection: { status: 'connected', lastError: null } })
    })
  })

  describe('through Codat (AGL-3636)', () => {
    it('is hidden until CODAT_API_KEY is configured, and refuses a connect', async () => {
      const context = setup()
      const response = await context.routes.status(context.request('GET', 'accounting/status?orgId=org-1'))
      expect(await response.json()).toMatchObject({ providers: { quickbooks: true, xero: true, codat: false } })
      const refused = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'codat' }))
      expect(refused.status).toBe(503)
      expect(context.providers.codat.authorizeUrl).not.toHaveBeenCalled()
    })

    it('connects end to end: Link for this workspace, the company back as the code, bound to its books', async () => {
      const context = setup({ codatConfigured: true })
      const started = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'codat' }))
      expect(started.status).toBe(200)
      const { url } = (await started.json()) as { url: string }
      expect(url.startsWith('https://link.codat.io/company/c-1?state=')).toBe(true)
      expect(context.providers.codat.authorizeUrl).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', orgName: 'Acme' }))
      const state = new URL(url).searchParams.get('state') ?? ''
      // The redirect the Codat Portal is set to send: `code={companyId}&state={state}&statusCode={statusCode}`.
      const callback = await context.routes.oauthCallback(
        new Request(
          `https://app.aglyn.com/api/accounting/oauth/callback?code=c-1&state=${encodeURIComponent(state)}&statusCode=200&connectionId=conn-1`,
        ),
      )
      expect(callback.status).toBe(303)
      const returned = parseAccountingConnectFragment((callback.headers.get('location') ?? '').split('#')[1] ?? '')
      expect(returned).toMatchObject({ kind: 'code', code: 'c-1' })
      const completed = await context.routes.connectComplete(
        context.request('POST', 'accounting/connect/complete', { orgId: 'org-1', ...returned }),
      )
      expect(completed.status).toBe(200)
      expect(context.providers.codat.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'c-1', orgId: 'org-1' }))
      expect(await completed.json()).toMatchObject({
        connection: { provider: 'codat', status: 'connected', tenantName: 'Acme Inc (NetSuite)', environment: null },
      })
      const record = readConnection(context.store.read('orgs/org-1/accountingConnections/codat'), keyring)!
      expect(record.sealedAccessToken).not.toContain('c-1')
    })

    it('hands a declined or failed Link back to the page as an error, never a code', async () => {
      const context = setup({ codatConfigured: true })
      const started = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'codat' }))
      const state = new URL(((await started.json()) as { url: string }).url).searchParams.get('state') ?? ''
      for (const [statusCode, reason] of [
        ['403', 'access_denied'],
        ['500', 'provider_error'],
      ]) {
        const callback = await context.routes.oauthCallback(
          new Request(
            `https://app.aglyn.com/api/accounting/oauth/callback?code=c-1&state=${encodeURIComponent(state)}&statusCode=${statusCode}`,
          ),
        )
        const returned = parseAccountingConnectFragment((callback.headers.get('location') ?? '').split('#')[1] ?? '')
        expect(returned).toEqual({ kind: 'error', reason })
      }
    })

    it('answers a Codat failure at connect as a provider error', async () => {
      const context = setup({ codatConfigured: true })
      ;(context.providers.codat.authorizeUrl as jest.Mock).mockRejectedValueOnce(
        new AccountingProviderError('transient', 'Codat is down.', 503),
      )
      const refused = await context.routes.connect(context.request('POST', 'accounting/connect', { orgId: 'org-1', provider: 'codat' }))
      expect(refused.status).toBe(502)
      expect(await refused.json()).toMatchObject({ reason: 'provider-error', error: 'Accounting software: Codat is down.' })
    })
  })
})
