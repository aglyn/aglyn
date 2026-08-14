/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * AGL-941: a Stripe customer row said only `zachary.w.gover@gmail.com`.
 *
 * The subscription has carried `metadata.orgId` since AGL-445; the CUSTOMER —
 * the row the dashboard lists — carried nothing. With one person owning
 * several orgs the customer list is ambiguous, and revenue cannot be grouped
 * by workspace at all.
 */
import {
  checkoutCustomerParams,
  stripeCustomerIdentityParams,
} from '../utils/stripe-customer-identity'

describe('stripeCustomerIdentityParams (AGL-941)', () => {
  it('names the customer after the workspace, and tags it both ways', () => {
    expect(
      stripeCustomerIdentityParams({
        orgId: 'org-1',
        name: 'Northwind Coffee',
        slug: 'northwind',
      }),
    ).toEqual({
      // `name` is the column Stripe's customer list actually renders — the
      // whole reason the dashboard was unreadable.
      name: 'Northwind Coffee',
      description: 'Aglyn workspace: northwind',
      'metadata[orgId]': 'org-1',
      'metadata[orgSlug]': 'northwind',
    })
  })

  it('falls back to the slug when the org has no display name', () => {
    const params = stripeCustomerIdentityParams({
      orgId: 'org-1',
      slug: 'northwind',
    })
    expect(params['name']).toBe('northwind')
    expect(params['metadata[orgId]']).toBe('org-1')
  })

  it('trims, so a stray space cannot become the customer name', () => {
    expect(
      stripeCustomerIdentityParams({ orgId: 'org-1', name: '  Acme  ' })[
        'name'
      ],
    ).toBe('Acme')
  })

  it('CONTROL — sends NOTHING when there is only a document id', () => {
    // The caller skips the request entirely on an empty map. A customer named
    // after a raw Firestore id is worse for the dashboard than one named
    // after the email, which at least identifies a human — and `orgId` alone
    // is already on the subscription, so the PATCH would buy nothing.
    expect(stripeCustomerIdentityParams({ orgId: 'org-1' })).toEqual({})
    expect(
      stripeCustomerIdentityParams({ orgId: 'org-1', name: '   ', slug: '' }),
    ).toEqual({})
  })

  it('CONTROL — sends nothing without an orgId', () => {
    // Tagging a customer with an empty orgId would poison the very grouping
    // this exists to enable.
    expect(
      stripeCustomerIdentityParams({ orgId: '', name: 'Northwind' }),
    ).toEqual({})
  })

  it('produces only valid Stripe form keys', () => {
    // Guards the shape as a whole: a typo'd bracket key is accepted by Stripe
    // as an unknown param and silently ignored, so it would never surface as
    // an error — only as a dashboard that is still unreadable.
    const params = stripeCustomerIdentityParams({
      orgId: 'org-1',
      name: 'Northwind Coffee',
      slug: 'northwind',
    })
    for (const key of Object.keys(params)) {
      expect(key).toMatch(/^(name|description|metadata\[[a-zA-Z]+\])$/)
    }
    // Encodable without loss — this goes out as x-www-form-urlencoded.
    expect(new URLSearchParams(params).toString()).toContain(
      'metadata%5BorgId%5D=org-1',
    )
  })
})

/**
 * The duplicate-customer half of AGL-941, and the riskier half: this decides
 * how every Checkout session addresses its customer, so a mistake here breaks
 * upgrades outright rather than just leaving the dashboard untidy.
 */
describe('checkoutCustomerParams (AGL-941)', () => {
  it('REGRESSION — reuses the org customer instead of minting a new one', () => {
    // `customer_email` creates a FRESH customer every checkout. Resubscribing
    // therefore left duplicates, with `stripeCustomerId` pointing only at the
    // newest — so older invoices sat on customers the Billing page never
    // queries, which reads to a user as invoices going missing.
    expect(checkoutCustomerParams('cus_123', 'owner@example.com')).toEqual({
      customer: 'cus_123',
      'customer_update[address]': 'auto',
    })
  })

  it('never sends customer AND customer_email together', () => {
    // Stripe REJECTS a session carrying both, so this is not a style
    // preference — a session that sets both fails and nobody can upgrade.
    const params = checkoutCustomerParams('cus_123', 'owner@example.com')
    expect('customer_email' in params).toBe(false)
    expect(Object.keys(params).sort()).toEqual([
      'customer',
      'customer_update[address]',
    ])
  })

  it('saves the collected address onto a REUSED customer (AGL-1537)', () => {
    // Automatic tax resolves an existing customer's tax location from the
    // CUSTOMER record, not from the address typed into the session — so a
    // reused customer with no stored address would make an `automatic_tax`
    // session unresolvable. `customer_update[address]=auto` writes the
    // session's billing address back onto the customer.
    expect(
      checkoutCustomerParams('cus_123', 'owner@example.com')[
        'customer_update[address]'
      ],
    ).toBe('auto')
  })

  it('CONTROL — never sends customer_update without a customer', () => {
    // Stripe rejects `customer_update` on a session that has no `customer`,
    // so leaking it onto the first-subscribe (customer_email) path would
    // break every first purchase.
    expect(
      'customer_update[address]' in
        checkoutCustomerParams(undefined, 'owner@example.com'),
    ).toBe(false)
    expect(
      'customer_update[address]' in checkoutCustomerParams('', ''),
    ).toBe(false)
  })

  it('CONTROL — first subscribe still identifies the buyer by email', () => {
    // Without this, "reuse the customer" is satisfied by sending neither,
    // which would leave Stripe with an anonymous customer on every FIRST
    // purchase — a worse dashboard than the one being fixed.
    expect(checkoutCustomerParams(undefined, 'owner@example.com')).toEqual({
      customer_email: 'owner@example.com',
    })
    expect(checkoutCustomerParams(null, 'owner@example.com')).toEqual({
      customer_email: 'owner@example.com',
    })
  })

  it('treats a blank stored id as no customer, not as a customer', () => {
    // A whitespace id would be sent verbatim and 404 at Stripe, failing the
    // checkout — worse than falling back to the email.
    expect(checkoutCustomerParams('   ', 'owner@example.com')).toEqual({
      customer_email: 'owner@example.com',
    })
  })

  it('sends nothing when there is neither — never an empty key', () => {
    expect(checkoutCustomerParams(undefined, undefined)).toEqual({})
    expect(checkoutCustomerParams('', '')).toEqual({})
  })
})

/**
 * `tools/scripts/backfill-stripe-org-identity.mjs` carries a hand-copied
 * `identityParams`, because a plain `.mjs` script has no build step and no
 * path aliases. A copy nobody checks is a copy that drifts — and this one
 * writes to LIVE customer records, so drift means the backfill stamping
 * something different from what the webhook stamps.
 *
 * Run out-of-process: the script is ESM and this suite is not, and running it
 * through node is also the honest test — it exercises the file as it will
 * actually be loaded.
 */
describe('backfill script mirrors the runtime rule (AGL-941)', () => {
  const CASES = [
    { orgId: 'org-1', name: 'Northwind Coffee', slug: 'northwind' },
    { orgId: 'org-1', slug: 'northwind' },
    { orgId: 'org-1', name: '  Acme  ' },
    // The empty cases matter most: this is where two implementations of
    // "nothing worth sending" most easily disagree.
    { orgId: 'org-1' },
    { orgId: 'org-1', name: '   ', slug: '' },
    { orgId: '', name: 'Northwind' },
  ]

  it('produces the same params as the TypeScript original', () => {
    const { execFileSync } = require('child_process')
    const { join } = require('path')
    const script = join(
      __dirname,
      '../../../tools/scripts/backfill-stripe-org-identity.mjs',
    )
    const program =
      `import { identityParams } from ${JSON.stringify(script)};` +
      `const cases = ${JSON.stringify(CASES)};` +
      'console.log(JSON.stringify(cases.map(identityParams)));'
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', program],
      { encoding: 'utf8' },
    )
    const fromScript = JSON.parse(output.trim()) as Array<Record<
      string,
      string
    > | null>

    const fromSource = CASES.map((input) => {
      const params = stripeCustomerIdentityParams(input)
      // The script returns `null` where the source returns `{}` — both mean
      // "send nothing", and the callers branch accordingly.
      return Object.keys(params).length ? params : null
    })

    expect(fromScript).toEqual(fromSource)
  })
})
