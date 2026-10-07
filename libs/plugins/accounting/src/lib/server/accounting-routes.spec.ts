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
import { parseAccountingConnectFragment } from '../model/accounting.types'
import { asFirestore, memoryFirestore } from '../testing/memory-firestore'
import type { AccountingProviderConfigResult } from './accounting-config'
import { createAccountingRoutes, type AccountingRouteDeps } from './accounting-routes'
import { openToken, readConnection } from './connection-store'
import type { AccountingProvider } from './providers/provider'

const NOW = Date.UTC(2026, 9, 6, 18)
const key = createSecretBoxKey(randomBytes(32))
const keyring = { current: key, keys: [key] }

const configured: AccountingProviderConfigResult = {
  configured: true,
  config: { clientId: 'id', clientSecret: 'secret', keyring, environment: 'sandbox', scopes: null },
}

function fakeProvider(id: 'quickbooks' | 'xero', overrides: Partial<AccountingProvider> = {}): AccountingProvider {
  return {
    id,
    picksTenantAfterExchange: id === 'xero',
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

function setup(options: { permissions?: Record<string, boolean>; commerce?: boolean; xeroConfigured?: boolean } = {}) {
  const store = memoryFirestore()
  const providers = { quickbooks: fakeProvider('quickbooks'), xero: fakeProvider('xero') }
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
        isOwner: true,
        orgWide: true,
        permissions: options.permissions ?? { 'accounting.manage': true },
      }),
      readOrg: async (orgId) =>
        orgId === 'org-1'
          ? { slug: 'acme', entitlements: { features: { commerce: options.commerce ?? true } } }
          : null,
      lockdownRefusal: async () => null,
    },
    readProviderConfig: (provider) =>
      provider === 'xero' && options.xeroConfigured === false ? { configured: false, missing: ['XERO_CLIENT_ID'] } : configured,
    providerFor: (provider) => (provider === 'xero' && options.xeroConfigured === false ? null : providers[provider]),
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
  return { store, routes, request, providers, activity }
}

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
      connection: { provider: 'quickbooks', status: 'connected', tenantId: 'realm-1', tenantName: 'Sandbox Company', homeCurrency: 'USD' },
    })
    expect(context.providers.quickbooks.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1', realmId: '9130', redirectUri: 'https://app.aglyn.com/api/accounting/oauth/callback' }),
    )
    const record = readConnection(context.store.read('orgs/org-1/accountingConnections/quickbooks'))!
    expect(openToken(keyring, record, 'refresh').token).toBe('refresh-1')
    expect(JSON.stringify(record)).not.toContain('refresh-1')
    expect(context.activity).toContain('accounting.connected')
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
})
