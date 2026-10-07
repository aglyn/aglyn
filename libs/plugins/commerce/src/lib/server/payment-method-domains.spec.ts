/**
 * @jest-environment node
 *
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
 * Stripe payment method domains through a site's life (AGL-3629): connected,
 * reconnected, shared with another site, released, and backfilled.
 *
 * Stripe is a small in-memory registry here, so the assertions read what
 * Stripe would end up holding — one registration per name, enabled or not —
 * rather than which calls happened to be made.
 */

const docs = new Map<string, Record<string, any>>()

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
  }
}

/** Enough of a query for `where` (==, in, >), `orderBy`, `startAfter`, `limit`. */
function query(collection: string, state: {
  filters: Array<[string, string, any]>
  order?: string
  after?: any
  max?: number
} = { filters: [] }): any {
  return {
    where: (field: string, op: string, value: any) =>
      query(collection, { ...state, filters: [...state.filters, [field, op, value]] }),
    orderBy: (field: string) => query(collection, { ...state, order: field }),
    startAfter: (value: any) => query(collection, { ...state, after: value }),
    limit: (max: number) => query(collection, { ...state, max }),
    doc: (id: string) => docRef(`${collection}/${id}`),
    get: async () => {
      let rows = [...docs.keys()]
        .filter((key) => key.startsWith(`${collection}/`) && key.split('/').length === 2)
        .map(snapshot)
        .filter((row) =>
          state.filters.every(([field, op, value]) => {
            const actual = row.get(field)
            if (op === '==') return actual === value
            if (op === 'in') return (value as any[]).includes(actual)
            if (op === '>') return typeof actual === 'string' && actual > value
            throw new Error(`op ${op}`)
          }),
        )
      if (state.order) {
        const field = state.order
        rows.sort((a, b) => String(a.get(field)).localeCompare(String(b.get(field))))
        if (state.after !== undefined) rows = rows.filter((row) => String(row.get(field)) > state.after)
      }
      if (state.max) rows = rows.slice(0, state.max)
      return { empty: rows.length === 0, size: rows.length, docs: rows }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({ collection: (name: string) => query(name) }) }) },
}))

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  customDomainNames,
  ensureCheckoutDomain,
  ensurePaymentMethodDomain,
  onHostDomainAttached,
  onHostDomainReleased,
  reconcileCustomDomains,
  registrableDomain,
  stripeModeOfKey,
} from './payment-method-domains'

// ---------------------------------------------------------------------------
// Stripe: a registry of payment method domains on the platform account
// ---------------------------------------------------------------------------

interface Registration {
  id: string
  domain_name: string
  enabled: boolean
}
let registry: Registration[] = []
let outage = false
/** Create the registration from "elsewhere" just before our create lands. */
let raceOnCreate = false
const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = []

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  const method = String(init?.method ?? 'GET')
  const headers = (init?.headers ?? {}) as Record<string, string>
  calls.push({ method, url: target, headers })
  if (!target.includes('/v1/payment_method_domains')) throw new Error(`Unexpected ${target}`)
  if (outage) return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) }
  const params = new URLSearchParams(String(init?.body ?? ''))
  const reply = (body: unknown) => ({ ok: true, json: async () => body })
  const shape = (entry: Registration) => ({ ...entry, apple_pay: { status: entry.enabled ? 'active' : 'inactive' } })
  if (method === 'GET') {
    const name = new URL(target).searchParams.get('domain_name')
    return reply({ data: registry.filter((entry) => entry.domain_name === name).map(shape) })
  }
  const byId = /payment_method_domains\/([^/?]+)$/.exec(target)
  if (byId) {
    const entry = registry.find((candidate) => candidate.id === decodeURIComponent(byId[1]))!
    entry.enabled = params.get('enabled') === 'true'
    return reply(shape(entry))
  }
  const name = String(params.get('domain_name'))
  if (raceOnCreate) {
    registry.push({ id: `pmd_${registry.length + 1}`, domain_name: name, enabled: true })
    return { ok: false, status: 400, json: async () => ({ error: { message: 'already exists' } }) }
  }
  const entry = { id: `pmd_${registry.length + 1}`, domain_name: name, enabled: params.get('enabled') === 'true' }
  registry.push(entry)
  return reply(shape(entry))
})

const registration = (name: string) => registry.filter((entry) => entry.domain_name === name)

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  docs.clear()
  registry = []
  outage = false
  raceOnCreate = false
  calls.length = 0
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('names', () => {
  it('registers only real hostnames', () => {
    expect(registrableDomain(' Shop.Acme.COM. ')).toBe('shop.acme.com')
    for (const bad of ['localhost', 'app.localhost', '127.0.0.1', '[::1]', 'acme', 'a b.com', '']) {
      expect(registrableDomain(bad)).toBeNull()
    }
  })

  it('pairs a custom domain with its www twin, either way round', () => {
    expect(customDomainNames('acme.com')).toEqual(['acme.com', 'www.acme.com'])
    expect(customDomainNames('www.acme.com')).toEqual(['www.acme.com', 'acme.com'])
    expect(customDomainNames('nope')).toEqual([])
  })

  it('knows test from live by the key, and refuses anything else', () => {
    expect(stripeModeOfKey('sk_live_x')).toBe('live')
    expect(stripeModeOfKey('rk_test_x')).toBe('test')
    expect(stripeModeOfKey('pk_live_x')).toBeNull()
    expect(stripeModeOfKey(undefined)).toBeNull()
  })
})

describe('connecting a domain', () => {
  it('registers the domain and its twin on the platform account, keyed, and records both', async () => {
    await onHostDomainAttached({ hostId: 'host-1', domain: 'shop.acme.com' })
    expect(registration('shop.acme.com')).toHaveLength(1)
    expect(registration('www.shop.acme.com')).toHaveLength(1)
    const creates = calls.filter((call) => call.method === 'POST')
    expect(creates.map((call) => call.headers['Idempotency-Key'])).toEqual([
      'aglyn-pmd-register:shop.acme.com',
      'aglyn-pmd-register:www.shop.acme.com',
    ])
    expect(creates.every((call) => call.headers['Stripe-Account'] === undefined)).toBe(true)
    expect(docs.get('paymentMethodDomains/test~shop.acme.com')).toMatchObject({
      enabled: true,
      stripeId: 'pmd_1',
      hostId: 'host-1',
      lastError: null,
    })
  })

  it('reconnecting re-enables the same registration rather than opening a second', async () => {
    registry = [{ id: 'pmd_old', domain_name: 'acme.com', enabled: false }]
    await onHostDomainAttached({ hostId: 'host-1', domain: 'acme.com' })
    expect(registration('acme.com')).toEqual([{ id: 'pmd_old', domain_name: 'acme.com', enabled: true }])
  })

  it('a create that loses a race to another still ends with one registration', async () => {
    raceOnCreate = true
    const result = await ensurePaymentMethodDomain('acme.com')
    expect(result.outcome).toBe('registered')
    expect(registration('acme.com')).toHaveLength(1)
  })

  it('records an outage for the daily pass instead of throwing', async () => {
    outage = true
    const result = await ensurePaymentMethodDomain('acme.com', { hostId: 'host-1' })
    expect(result.outcome).toBe('failed')
    expect(docs.get('paymentMethodDomains/test~acme.com')).toMatchObject({
      enabled: false,
      lastError: 'down',
    })
  })

  it('a recorded registration costs no Stripe call, and a live key is a separate record', async () => {
    await ensurePaymentMethodDomain('acme.com')
    calls.length = 0
    expect((await ensurePaymentMethodDomain('acme.com')).outcome).toBe('cached')
    expect(calls).toHaveLength(0)
    process.env.STRIPE_SECRET_KEY = 'sk_live_not_a_real_key'
    expect((await ensurePaymentMethodDomain('acme.com')).outcome).toBe('registered')
    expect(docs.has('paymentMethodDomains/live~acme.com')).toBe(true)
  })

  it('does nothing without a Stripe key', async () => {
    delete process.env.STRIPE_SECRET_KEY
    expect((await ensurePaymentMethodDomain('acme.com')).outcome).toBe('skipped')
    expect(calls).toHaveLength(0)
  })
})

describe('the checkout hook', () => {
  const site = { subdomain: 'acme', cname: 'acme.com' }

  it('registers the page’s own host', async () => {
    const result = await ensureCheckoutDomain({ pageUrl: 'https://www.acme.com/cart', site, hostId: 'host-1' })
    expect(result?.domain).toBe('www.acme.com')
    expect(registration('www.acme.com')).toHaveLength(1)
  })

  it('never a host the site does not answer on, nor a local one', async () => {
    expect(
      await ensureCheckoutDomain({ pageUrl: 'https://evil.example/x', site, hostId: 'host-1' }),
    ).toBeNull()
    expect(
      await ensureCheckoutDomain({ pageUrl: 'not a url', site, hostId: 'host-1' }),
    ).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('releasing a domain', () => {
  it('disabling it, and its twin, when no other site serves them', async () => {
    await onHostDomainAttached({ hostId: 'host-1', domain: 'acme.com' })
    await onHostDomainReleased({ hostId: 'host-1', domain: 'acme.com' })
    expect(registration('acme.com')[0].enabled).toBe(false)
    expect(registration('www.acme.com')[0].enabled).toBe(false)
    expect(docs.get('paymentMethodDomains/test~acme.com')).toMatchObject({ enabled: false })
  })

  it('leaves a name another site still serves', async () => {
    await onHostDomainAttached({ hostId: 'host-1', domain: 'acme.com' })
    // The www twin is ANOTHER site's own custom domain.
    docs.set('hosts/host-2', { cname: 'www.acme.com' })
    await onHostDomainReleased({ hostId: 'host-1', domain: 'acme.com' })
    expect(registration('acme.com')[0].enabled).toBe(true)
    expect(registration('www.acme.com')[0].enabled).toBe(true)
  })

  it('a deleted site’s subdomain is released alone, unless a new site took it', async () => {
    const name = `acme.${TENANT_APEX}`
    await ensurePaymentMethodDomain(name)
    docs.set('hosts/host-9', { subdomain: 'acme' })
    await onHostDomainReleased({ hostId: 'host-1', domain: name })
    expect(registration(name)[0].enabled).toBe(true)
    docs.delete('hosts/host-9')
    await onHostDomainReleased({ hostId: 'host-1', domain: name })
    expect(registration(name)[0].enabled).toBe(false)
    expect(registration(`www.${name}`)).toHaveLength(0)
  })

  it('a name Stripe never held is recorded absent, not created', async () => {
    await onHostDomainReleased({ hostId: 'host-1', domain: 'never.example.com' })
    expect(registry).toHaveLength(0)
    expect(docs.get('paymentMethodDomains/test~never.example.com')).toMatchObject({
      enabled: false,
      stripeId: null,
    })
  })
})

describe('the daily backfill', () => {
  it('registers every connected custom domain once, skips locked sites, and pages through', async () => {
    for (let index = 0; index < 5; index += 1) {
      docs.set(`hosts/host-${index}`, { cname: `shop${index}.example.com` })
    }
    docs.set('hosts/host-none', { subdomain: 'plain' })
    const gate = { isLocked: async (hostId: string) => hostId === 'host-3' }

    const first = await reconcileCustomDomains(gate)
    expect(first).toEqual({ hosts: 5, registered: 8, failed: 0, skippedLocked: 1 })
    expect(registration('shop3.example.com')).toHaveLength(0)
    expect(registration('www.shop0.example.com')).toHaveLength(1)

    // The steady state: every name recorded, no Stripe call at all.
    calls.length = 0
    const second = await reconcileCustomDomains(gate)
    expect(second.registered).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('does nothing without a Stripe key', async () => {
    delete process.env.STRIPE_SECRET_KEY
    docs.set('hosts/host-1', { cname: 'acme.com' })
    expect(await reconcileCustomDomains({ isLocked: async () => false })).toMatchObject({ hosts: 0 })
  })
})
