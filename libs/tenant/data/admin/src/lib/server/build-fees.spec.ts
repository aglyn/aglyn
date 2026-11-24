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
 * AGL-4244 — a website build fee is charged once: which fee a checkout owes,
 * the product it is priced against, and its payment recorded once on every
 * source that carried it. No Firebase and no live Stripe: the module takes
 * the caller's Firestore handle and a `fetchImpl`, both faked here.
 */

import {
  buildFeeLineParams,
  buildFeeProduct,
  readWorkspaceBuildFees,
  recordBuildFeePayment,
  resolveDueBuildFee,
} from './build-fees'

type Doc = Record<string, any>

let store = new Map<string, Doc>()

function setPath(target: Doc, dotted: string, value: unknown): void {
  const keys = dotted.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) {
    node[key] = { ...(node[key] ?? {}) }
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
}

function deepMerge(base: Doc, patch: Doc): Doc {
  const out: Doc = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
        ? deepMerge(base[key] ?? {}, value)
        : value
  }
  return out
}

const snapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  ref: makeDoc(path),
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => (store.get(path) ?? {})[field],
})

let autoId = 0
function makeDoc(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshot(path),
    update: async (patch: Doc) => {
      if (!store.has(path)) throw new Error('NOT_FOUND')
      const next = { ...(store.get(path) as Doc) }
      for (const [key, value] of Object.entries(patch)) setPath(next, key, value)
      store.set(path, next)
    },
  }
}
function makeCollection(prefix: string): any {
  return {
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${(autoId += 1)}`}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: [...store.keys()]
            .filter(
              (path) =>
                path.startsWith(`${prefix}/`) &&
                !path.slice(prefix.length + 1).includes('/') &&
                (store.get(path) as Doc)[field] === value,
            )
            .map(snapshot),
        }),
      }),
    }),
  }
}
const db: any = {
  collection: (name: string) => makeCollection(name),
  runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const writes: Array<() => void> = []
    const tx = {
      get: async (ref: { path: string }) => snapshot(ref.path),
      update: (ref: { path: string }, patch: Doc) =>
        writes.push(() => {
          const next = { ...(store.get(ref.path) as Doc) }
          for (const [key, value] of Object.entries(patch)) setPath(next, key, value)
          store.set(ref.path, next)
        }),
      set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) =>
        writes.push(() =>
          store.set(ref.path, options?.merge ? deepMerge(store.get(ref.path) ?? {}, data) : data),
        ),
    }
    const result = await fn(tx)
    for (const write of writes) write()
    return result
  },
}

/** A Stripe that answers by path, recording every call. */
let stripeCalls: string[] = []
let stripeAnswers: Record<string, { ok?: boolean; body: Doc }> = {}
const fetchImpl = (async (href: string) => {
  stripeCalls.push(String(href))
  const path = String(href).replace('https://api.stripe.com/v1/', '').split('?')[0]
  const answer = stripeAnswers[path] ?? { ok: false, body: { error: { message: 'not found' } } }
  return { ok: answer.ok !== false, status: answer.ok === false ? 404 : 200, json: async () => answer.body }
}) as unknown as typeof fetch
const stripe = { secretKey: 'sk_test_fake', fetchImpl }

const ORG = 'org-1'
const FEE = { amountCents: 35000, label: 'Website build' }
const audits = () => [...store.entries()].filter(([path]) => path.startsWith('adminAudit/')).map(([, row]) => row)

beforeEach(() => {
  store = new Map()
  stripeCalls = []
  stripeAnswers = {}
  store.set(`orgs/${ORG}`, {
    slug: 'acme',
    upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1, buildFee: { ...FEE } },
  })
  store.set('bundleLinks/link-1', { workspaceId: ORG, buildFee: { amountCents: 10000, label: 'Marketing site' } })
  store.set('bundleLinks/link-2', { workspaceId: ORG, buildFee: { amountCents: 10000, label: 'Marketing site' } })
  store.set('bundleLinks/other', { workspaceId: 'org-2', buildFee: { amountCents: 99900, label: 'Not yours' } })
})

describe('which build fee a checkout owes', () => {
  it('is the opened link’s, ahead of the proposal’s', async () => {
    expect(await resolveDueBuildFee(db, { orgId: ORG, bundleLinkId: 'link-1' }, stripe)).toEqual({
      fee: { amountCents: 10000, label: 'Marketing site' },
      source: { kind: 'bundle-link', id: 'link-1' },
    })
  })

  it('is the proposal’s with no link, or with a link for another workspace', async () => {
    for (const bundleLinkId of [null, 'other', 'missing', 'a/b']) {
      expect(await resolveDueBuildFee(db, { orgId: ORG, bundleLinkId }, stripe)).toEqual({
        fee: FEE,
        source: { kind: 'proposal' },
      })
    }
  })

  it('is none once paid, for a change-of-plan proposal, or once the subscription is live', async () => {
    store.set('bundleLinks/link-1', {
      workspaceId: ORG,
      buildFee: { amountCents: 10000, label: 'Marketing site', paidInvoiceId: 'in_1', paidAt: 1 },
    })
    store.set(`orgs/${ORG}`, {
      upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1, buildFee: { ...FEE, paidInvoiceId: 'in_1' } },
    })
    expect(await resolveDueBuildFee(db, { orgId: ORG, bundleLinkId: 'link-1' }, stripe)).toBeNull()
    store.set(`orgs/${ORG}`, {
      upgradeProposal: { plan: 'pro', proposedBy: 'staff', proposedAt: 1, forSubscriber: true, buildFee: FEE },
    })
    expect(await resolveDueBuildFee(db, { orgId: ORG }, stripe)).toBeNull()
    store.set(`orgs/${ORG}`, {
      billingStatus: 'active',
      upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1, buildFee: FEE },
    })
    expect(await resolveDueBuildFee(db, { orgId: ORG }, stripe)).toBeNull()
    expect(stripeCalls).toEqual([])
  })

  it('asks Stripe about an invoice an earlier subscription carried, and never charges a paid one again', async () => {
    store.set('bundleLinks/link-1', {
      workspaceId: ORG,
      buildFee: { amountCents: 10000, label: 'Marketing site', invoiceId: 'in_paid', subscriptionId: 'sub_1' },
    })
    stripeAnswers['invoices/in_paid'] = { body: { id: 'in_paid', status: 'paid' } }
    expect(await resolveDueBuildFee(db, { orgId: ORG, bundleLinkId: 'link-1' }, stripe)).toBeNull()
    // The missed webhook is made good: every fee for the build is paid now.
    expect(store.get('bundleLinks/link-1')?.['buildFee']).toMatchObject({ paidInvoiceId: 'in_paid' })
    expect(store.get(`orgs/${ORG}`)?.['upgradeProposal']?.['buildFee']).toMatchObject({ paidInvoiceId: 'in_paid' })
    expect(await resolveDueBuildFee(db, { orgId: ORG }, stripe)).toBeNull()
  })

  it('stays due when the earlier invoice was never paid (a declined card, an expired attempt)', async () => {
    store.set('bundleLinks/link-1', {
      workspaceId: ORG,
      buildFee: { amountCents: 10000, label: 'Marketing site', invoiceId: 'in_void' },
    })
    stripeAnswers['invoices/in_void'] = { body: { id: 'in_void', status: 'void' } }
    expect(await resolveDueBuildFee(db, { orgId: ORG, bundleLinkId: 'link-1' }, stripe)).toMatchObject({
      source: { kind: 'bundle-link', id: 'link-1' },
    })
  })
})

describe('the fee is priced against a product with the Aglyn service tax code', () => {
  it('uses the website build product when one is configured, with its code checked', async () => {
    stripeAnswers['products/prod_build'] = { body: { id: 'prod_build', tax_code: 'txcd_10103001' } }
    expect(await buildFeeProduct({ ...stripe, productId: 'prod_build' })).toEqual({ ok: true, productId: 'prod_build' })
    stripeAnswers['products/prod_wrong'] = { body: { id: 'prod_wrong', tax_code: 'txcd_99999999' } }
    expect(await buildFeeProduct({ ...stripe, productId: 'prod_wrong' })).toMatchObject({ ok: false })
  })

  it('finds the Aglyn "Website build" product by its metadata, never the Site Care product', async () => {
    stripeAnswers['products/search'] = { body: { data: [{ id: 'prod_website_build' }] } }
    stripeAnswers['products/prod_website_build'] = { body: { id: 'prod_website_build', tax_code: 'txcd_10103001' } }
    expect(await buildFeeProduct({ ...stripe, productId: '' })).toEqual({ ok: true, productId: 'prod_website_build' })
    expect(stripeCalls.some((href) => href.includes('/prices/'))).toBe(false)
  })

  it('makes the "Website build" product once, with the service tax code, when none exists', async () => {
    stripeAnswers['products/search'] = { body: { data: [] } }
    stripeAnswers['products'] = { body: { id: 'prod_new_build' } }
    stripeAnswers['products/prod_new_build'] = { body: { id: 'prod_new_build', tax_code: 'txcd_10103001' } }
    expect(await buildFeeProduct({ ...stripe, productId: '' })).toEqual({ ok: true, productId: 'prod_new_build' })
  })

  it('charges nothing when the product cannot be found or made', async () => {
    stripeAnswers['products/search'] = { ok: false, body: { error: { message: 'Stripe is down' } } }
    expect(await buildFeeProduct({ ...stripe, productId: '' })).toEqual({ ok: false, error: 'Stripe is down' })
  })

  it('is a tax-exclusive one-time line of one', () => {
    expect(buildFeeLineParams('add_invoice_items[0]', FEE, 'prod_care')).toEqual({
      'add_invoice_items[0][price_data][product]': 'prod_care',
      'add_invoice_items[0][price_data][currency]': 'usd',
      'add_invoice_items[0][price_data][unit_amount]': '35000',
      'add_invoice_items[0][price_data][tax_behavior]': 'exclusive',
      'add_invoice_items[0][quantity]': '1',
    })
  })
})

describe('the payment is recorded once', () => {
  it('marks the source and every other fee for the build paid, keeps it on billing, and audits it', async () => {
    const outcome = await recordBuildFeePayment(db, {
      orgId: ORG,
      source: { kind: 'bundle-link', id: 'link-1' },
      invoiceId: 'in_first',
      subscriptionId: 'sub_1',
      now: 1000,
    })
    expect(outcome).toBe('recorded')
    for (const path of ['bundleLinks/link-1', 'bundleLinks/link-2']) {
      expect(store.get(path)?.['buildFee']).toMatchObject({ paidInvoiceId: 'in_first', paidAt: 1000 })
    }
    expect(store.get(`orgs/${ORG}`)?.['upgradeProposal']?.['buildFee']).toMatchObject({ paidInvoiceId: 'in_first' })
    // Another workspace's link is not touched.
    expect(store.get('bundleLinks/other')?.['buildFee']).not.toHaveProperty('paidInvoiceId')
    expect(store.get(`orgs/${ORG}/billing/stripe`)?.['buildFeesPaid']).toEqual({
      in_first: { source: 'bundle:link-1', amountCents: 10000, label: 'Marketing site', subscriptionId: 'sub_1', paidAt: 1000 },
    })
    expect(audits()).toEqual([
      expect.objectContaining({ actorUid: 'system', action: 'billing.build-fee-paid', target: `orgs/${ORG}` }),
    ])
  })

  it('writes nothing on a redelivery of the same invoice', async () => {
    const input = { orgId: ORG, source: { kind: 'proposal' as const }, invoiceId: 'in_first', now: 1000 }
    expect(await recordBuildFeePayment(db, input)).toBe('recorded')
    expect(await recordBuildFeePayment(db, { ...input, now: 2000 })).toBe('already')
    expect(audits()).toHaveLength(1)
    expect(store.get('bundleLinks/link-2')?.['buildFee']).toMatchObject({ paidAt: 1000 })
  })

  it('is still kept when the live subscription already cleared the proposal', async () => {
    store.set(`orgs/${ORG}`, { slug: 'acme' })
    store.delete('bundleLinks/link-1')
    store.delete('bundleLinks/link-2')
    expect(
      await recordBuildFeePayment(db, { orgId: ORG, source: { kind: 'proposal' }, invoiceId: 'in_first', now: 7 }),
    ).toBe('recorded')
    expect(store.get(`orgs/${ORG}/billing/stripe`)?.['buildFeesPaid']?.['in_first']).toMatchObject({
      source: 'proposal',
      paidAt: 7,
    })
  })
})

describe('the fees staff are warned about before a Charge for work invoice', () => {
  it('lists each distinct fee once, paid or not', async () => {
    store.set('bundleLinks/link-2', {
      workspaceId: ORG,
      buildFee: { amountCents: 10000, label: 'Marketing site', paidInvoiceId: 'in_1' },
    })
    expect(await readWorkspaceBuildFees(db, ORG)).toEqual([
      { source: 'proposal', amountCents: 35000, label: 'Website build', paid: false },
      { source: 'bundle-link', amountCents: 10000, label: 'Marketing site', paid: false },
      { source: 'bundle-link', amountCents: 10000, label: 'Marketing site', paid: true },
    ])
  })
})
